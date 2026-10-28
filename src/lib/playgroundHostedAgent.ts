import { nativeAgentModels, nativeConversationModels, nativeAgentTurn, readAgentJson, type NativeAgentRequest, type NativeCall, type NativeConversationTurn } from "./playgroundAgent";
import { NativeAgentLoop, type AgentApproval, type AgentInvocation, type AgentLoopEvent, type AgentLoopServices, type AgentWorkspace } from "./playgroundAgentLoop";
import { AgentConsentQueue } from "./playgroundAgentConsent";
import { AgentQuestionQueue, type QuestionChallenge, type QuestionDecision } from "./playgroundQuestions";
import { buildProposalReview, type ReviewContext, type ReviewMode } from "./playgroundAgentReview";
import { isPlaygroundModelKey, isVisionModelKey, isAudioModelKey } from "./modelAccess";
import { validateProject, type ProjectFile } from "./playgroundProject";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXEC = /^exec-[0-9a-f]{24}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function freeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
type Json = (path: string, method: "GET" | "POST" | "PUT" | "DELETE", body: unknown, signal: AbortSignal, timeoutMs: number, version?: boolean) => Promise<Record<string, unknown>>;
export type HostedAgentIo = { models: typeof nativeAgentModels; turn: typeof nativeAgentTurn; json: Json };
const defaultIo: HostedAgentIo = { models: nativeConversationModels, turn: nativeAgentTurn,
	json: (path, method, body, signal, timeoutMs, version = true) => readAgentJson(path, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) }, signal, timeoutMs, version) };
type Challenge = { actionId: string; runId: string; sandboxId: string; toolCallId: string; requiresApproval: boolean; expiresAt: number };
type Pending = { call: NativeCall; ticket: string; challenge: Challenge | null; approved: boolean; consumed: boolean };

/** Real hosted adapter: only a server-signed settled proposal can be prepared. The server's
 * atomic claim, not this local cache/queue, is the actual one-shot dispatch authority. */
export class HostedAgentServices implements AgentLoopServices {
	private readonly pending = new Map<string, Pending>();
	invalidated = false;
	discardConfirmed = false;
	readonly ask?: (question: QuestionChallenge, signal: AbortSignal) => Promise<QuestionDecision>;
	constructor(readonly workspace: AgentWorkspace, private readonly models: readonly string[], private readonly consent: AgentConsentQueue, private readonly io = defaultIo,
		private readonly discardWorkspace?: (workspace: AgentWorkspace) => Promise<boolean>, private readonly questions?: AgentQuestionQueue) {
		if (questions) this.ask = (question, signal) => {
			if (this.invalidated) return Promise.reject(new Error("Questions are unavailable."));
			return questions.request(question, signal);
		};
	}
	supportsModel = (model: string) => !this.invalidated && this.models.includes(model);
	turn = async (request: NativeAgentRequest, signal: AbortSignal) => {
		signal.throwIfAborted();
		if (this.invalidated) throw new Error("This workspace cannot be reused.");
		const reply = await this.io.turn(request, signal);
		signal.throwIfAborted();
		if (this.invalidated) throw new Error("This workspace cannot be reused.");
		for (const call of reply.tool_calls) {
			if (call.name === "question") continue; // Interaction has no executable ticket or broker dispatch.
			const ticket = reply.action_tickets?.find(item => item.tool_call_id === call.id);
			if (!ticket || ticket.expires_at * 1000 <= Date.now() || this.pending.has(call.id) || this.pending.size >= 48) throw new Error("Missing, expired or repeated server action evidence.");
			this.pending.set(call.id, { call: freeze({ ...call }), ticket: ticket.token, challenge: null, approved: false, consumed: false });
		}
		return reply;
	};
	private item(workspace: AgentWorkspace, call: NativeCall): Pending {
		const item = this.pending.get(call.id);
		if (this.invalidated || workspace.id !== this.workspace.id || workspace.location !== "hosted-docker" || !item || item.consumed || item.call.name !== call.name || item.call.arguments !== call.arguments) throw new Error("Changed or consumed action.");
		return item;
	}
	private async prepare(item: Pending, signal: AbortSignal) {
		if (item.challenge) return item.challenge;
		const body = await this.io.json("/api/playground/agent/actions", "POST", { ticket: item.ticket, sandboxId: this.workspace.id, call: item.call }, signal, 25_000);
		if (body.version !== 1 || typeof body.actionId !== "string" || !UUID.test(body.actionId) || typeof body.runId !== "string" || !EXEC.test(body.runId) ||
			body.sandboxId !== this.workspace.id || body.toolCallId !== item.call.id || body.requiresApproval !== (item.call.name !== "read_file") || !Number.isSafeInteger(body.expiresAt) || Number(body.expiresAt) * 1000 <= Date.now()) throw new Error("Invalid server action challenge.");
		return item.challenge = freeze(body as unknown as Challenge);
	}
	approve = async (approval: AgentApproval, signal: AbortSignal) => {
		const item = this.item(approval.workspace, approval.call);
		const challenge = await this.prepare(item, signal);
		signal.throwIfAborted();
		this.item(approval.workspace, approval.call);
		if (!challenge.requiresApproval) throw new Error("Unexpected approval policy.");
		const decision = await this.consent.request(approval, signal);
		if (decision.approved && decision.approvalId === approval.id && !signal.aborted) item.approved = true;
		else if (!signal.aborted) {
			item.consumed = true;
			await this.io.json(`/api/playground/agent/actions/${challenge.actionId}/execute`, "POST", { approved: false, sandboxId: this.workspace.id, call: item.call }, signal, 25_000);
		}
		return decision;
	};
	invoke = async (workspace: AgentWorkspace, call: NativeCall, signal: AbortSignal) => {
		const item = this.item(workspace, call); const challenge = await this.prepare(item, signal);
		signal.throwIfAborted();
		if (this.invalidated || item.consumed) throw new Error("Changed or consumed action.");
		if (challenge.requiresApproval && !item.approved) throw new Error("Fresh approval is required.");
		if (challenge.expiresAt * 1000 <= Date.now()) throw new Error("The action challenge expired.");
		item.consumed = true; // Consume locally BEFORE the non-retrying POST, even if its reply is lost.
		const body = await this.io.json(`/api/playground/agent/actions/${challenge.actionId}/execute`, "POST", { approved: true, sandboxId: workspace.id, call: item.call }, signal, 90_000);
		if (body.version !== 1 || body.actionId !== challenge.actionId || body.runId !== challenge.runId || body.sandboxId !== workspace.id || body.toolCallId !== call.id || body.status !== "complete" || body.executed !== true || !object(body.result)) throw new Error("Unconfirmed action result.");
		const result = body.result;
		if (typeof result.stdout !== "string" || typeof result.stderr !== "string" || result.stdout.length + result.stderr.length > 16_000 || !Number.isInteger(result.exitCode) || Number(result.exitCode) < -2_147_483_648 || Number(result.exitCode) > 2_147_483_647 || result.timedOut !== false || typeof result.truncated !== "boolean" || typeof result.durationMs !== "number" || !Number.isFinite(result.durationMs) || result.durationMs < 0) throw new Error("Invalid action result envelope.");
		return { stdout: result.stdout, stderr: result.stderr, exitCode: Number(result.exitCode), timedOut: false, truncated: result.truncated };
	};
	abort = async (workspace: AgentWorkspace, signal: AbortSignal): Promise<boolean> => {
		this.invalidated = true; this.consent.clear(); this.questions?.dismiss();
		if (workspace.id !== this.workspace.id) return false;
		if (this.discardWorkspace) return this.discardConfirmed = await this.discardWorkspace(workspace);
		try { const reply = await this.io.json(`/api/playground/sandbox/${workspace.id}`, "DELETE", undefined, signal, 10_000, false); return this.discardConfirmed = reply.stopped === true; }
		catch { return this.discardConfirmed; }
	};
}

export type HostedAgentSnapshot = {
	phase: "idle" | "checking" | "creating" | "inspecting" | "ready" | "running" | "awaiting_approval" | "awaiting_question" | "complete" | "failed" | "stopping";
	models: readonly string[]; executionEnabled: boolean; workspace: AgentWorkspace | null; quarantined: AgentWorkspace | null;
	creationPending: boolean;
	pendingApproval: AgentApproval | null; pendingQuestion: QuestionChallenge | null; conversationTurns: number; requiresReset: boolean; queuedPrompt: string | null; events: readonly AgentLoopEvent[]; error: string;
};

/** Client-local, revision-safe composition. Opening it performs no network/execution. */
export class HostedAgentWorkspace {
	private state: HostedAgentSnapshot = freeze({ phase: "idle", models: [], executionEnabled: false, workspace: null, quarantined: null, creationPending: false, pendingApproval: null, pendingQuestion: null, conversationTurns: 0, requiresReset: false, queuedPrompt: null, events: [], error: "" });
	private readonly listeners = new Set<() => void>();
	private readonly consent = new AgentConsentQueue();
	private readonly questions = new AgentQuestionQueue();
	private conversation: NativeConversationTurn[] = [];
	private conversationKey: string | null = null;
	private queued: { context: ReviewContext; mode: ReviewMode; prompt: string } | null = null;
	private active: AbortController | null = null;
	private revision = 0;
	private disposed = false;
	private cleanup: { id: string; promise: Promise<boolean> } | null = null;
	private readonly unsubscribe: () => void;
	private readonly unsubscribeQuestions: () => void;
	constructor(private readonly io = defaultIo) {
		const changed = () => {
			const pendingApproval = this.consent.getSnapshot(); const pendingQuestion = this.questions.getSnapshot();
			if (["running", "awaiting_approval", "awaiting_question"].includes(this.state.phase)) this.publish({ ...this.state, pendingApproval, pendingQuestion,
				phase: pendingQuestion ? "awaiting_question" : pendingApproval ? "awaiting_approval" : "running" });
		};
		this.unsubscribe = this.consent.subscribe(changed); this.unsubscribeQuestions = this.questions.subscribe(changed);
	}
	getSnapshot = () => this.state;
	/** An explicit read-only observation of the SAME sandbox the agent uses. No model turn,
	 * approval or write is created. Reads are sequential observations, not a filesystem-wide
	 * atomic snapshot; other authenticated clients must not edit this sandbox concurrently. */
	async captureProject(): Promise<readonly ProjectFile[]> {
		const workspace = this.state.workspace;
		if (!workspace || this.state.quarantined) throw new Error("No reusable sandbox is connected.");
		const previousPhase = this.state.phase;
		const job = this.begin("inspecting"); if (!job) throw new Error("Wait for the current operation to finish.");
		const { controller, revision } = job;
		const timer = setTimeout(() => controller.abort(), 60_000);
		try {
			const listing = await this.io.json(`/api/playground/sandbox/${workspace.id}/files`, "GET", undefined, controller.signal, 20_000, false);
			if (!Array.isArray(listing.files) || listing.files.length > 256 || listing.files.some(path => typeof path !== "string")) throw new Error("Workspace listing is invalid or exceeds 256 files.");
			validateProject(listing.files.map(path => ({ path, text: "" })));
			const files: ProjectFile[] = [];
			for (const path of listing.files as string[]) {
				if (!this.current(controller, revision)) throw new Error("Workspace changed during inspection.");
				const file = await this.io.json(`/api/playground/sandbox/${workspace.id}/file?${new URLSearchParams({ path })}`, "GET", undefined, controller.signal, 20_000, false);
				if (file.path !== path || typeof file.text !== "string") throw new Error("Invalid workspace file response.");
				files.push({ path, text: file.text }); validateProject(files);
			}
			if (!this.current(controller, revision)) throw new Error("Workspace changed during inspection.");
			return validateProject(files);
		} finally {
			clearTimeout(timer);
			if (this.active === controller && this.revision === revision) { this.active = null; this.publish({ ...this.state, phase: previousPhase }); }
		}
	}
	newConversation(): boolean {
		if (this.active || this.state.creationPending || this.state.quarantined || this.state.requiresReset) return false;
		this.consent.clear(); this.questions.dismiss(); this.conversation = []; this.conversationKey = null; this.queued = null;
		this.publish({ ...this.state, conversationTurns: 0, queuedPrompt: null, pendingApproval: null, pendingQuestion: null,
			events: [...this.state.events, { kind: "message", text: "New conversation boundary: prior model context was explicitly cleared. Sandbox files are retained; no approvals are retained." }].slice(-256) as AgentLoopEvent[] });
		return true;
	}
	async uploadReviewedFile(file: ProjectFile, reviewed: boolean): Promise<void> {
		const workspace = this.state.workspace;
		if (reviewed !== true || !workspace || this.state.quarantined || this.state.requiresReset) throw new Error("Review this exact write in a reusable workspace first.");
		const [validated] = validateProject([file]);
		const previousPhase = this.state.phase; const job = this.begin("inspecting");
		if (!job) throw new Error("Wait for the current operation to finish.");
		const { controller, revision } = job;
		try {
			const reply = await this.io.json(`/api/playground/sandbox/${workspace.id}/file`, "PUT", { ...validated, approved: true }, controller.signal, 20_000, false);
			if (!this.current(controller, revision)) throw new Error("Workspace changed during upload.");
			if (reply.path !== validated.path || reply.bytes !== new TextEncoder().encode(validated.text).length) throw new Error("Unconfirmed write result. Inspect files before continuing.");
		} catch (error) {
			// A lost write response is ambiguous, never an automatically retryable upload.
			if (this.current(controller, revision)) this.publish({ ...this.state, requiresReset: true, error: "File upload was unconfirmed. Inspect/export and discard the sandbox; no retry was attempted." });
			throw error;
		} finally { if (this.current(controller, revision)) { this.active = null; this.publish({ ...this.state, phase: previousPhase }); } }
	}
	subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	private publish(state: HostedAgentSnapshot) { this.state = freeze(state); if (!this.disposed) for (const listener of this.listeners) listener(); }
	private current(controller: AbortController, revision: number) { return !this.disposed && !controller.signal.aborted && this.active === controller && this.revision === revision; }
	private begin(phase: HostedAgentSnapshot["phase"]) {
		if (this.disposed || this.active || this.state.phase === "stopping" || this.state.creationPending) return null;
		const controller = new AbortController(); const revision = ++this.revision; this.active = controller;
		this.publish({ ...this.state, phase, error: "", pendingApproval: null, pendingQuestion: null }); return { controller, revision };
	}
	async check() {
		const job = this.begin("checking"); if (!job) return;
		const { controller, revision } = job;
		try {
			const [models, capabilities] = await Promise.all([this.io.models(controller.signal), this.io.json("/api/playground/agent/actions/capabilities", "GET", undefined, controller.signal, 8000)]);
			if (!this.current(controller, revision)) return;
			if (models.length > 6 || new Set(models).size !== models.length || models.some(model => !isPlaygroundModelKey(model) || isVisionModelKey(model) || isAudioModelKey(model)) || capabilities.version !== 1 || capabilities.protocol !== "actions-v1" || capabilities.location !== "hosted-docker" || typeof capabilities.enabled !== "boolean") throw new Error("Invalid agent availability response.");
			this.publish({ ...this.state, models: [...models], executionEnabled: capabilities.enabled, phase: "ready", error: capabilities.enabled ? "" : "Agent execution is not enabled/qualified on this deployment. Proposal review and ordinary chat remain available." });
		} catch { if (this.current(controller, revision)) this.publish({ ...this.state, phase: "failed", models: [], executionEnabled: false, error: "Agent availability could not be verified." }); }
		finally { if (this.current(controller, revision)) this.active = null; }
	}
	async startSandbox() {
		if (!this.state.executionEnabled || !this.state.models.length || this.state.workspace || this.state.quarantined) return;
		const job = this.begin("creating"); if (!job) return;
		const { controller, revision } = job;
		this.publish({ ...this.state, creationPending: true });
		try {
			const body = await this.io.json("/api/playground/sandbox", "POST", undefined, controller.signal, 25_000, false);
			if (typeof body.id !== "string" || !UUID.test(body.id) || body.location !== "hosted-docker" || body.network !== "disabled" || body.workspace !== "/workspace" || body.ephemeral !== true || body.policyVersion !== 2) throw new Error("Invalid sandbox readiness response.");
			const workspace: AgentWorkspace = freeze({ id: body.id, location: "hosted-docker" });
			if (!this.current(controller, revision)) {
				const confirmed = await this.discard(workspace);
				if (!confirmed && !this.disposed && !this.state.workspace) this.publish({ ...this.state, phase: "failed", quarantined: workspace,
					error: "A late-created workspace could not be discarded. Do not start another; retry discard or contact an operator." });
				return;
			}
			this.conversation = []; this.conversationKey = null;
			this.publish({ ...this.state, phase: "ready", workspace, events: [], conversationTurns: 0, requiresReset: false, queuedPrompt: null, error: "" });
		} catch { if (this.current(controller, revision)) this.publish({ ...this.state, phase: "failed", error: "Sandbox creation was unavailable or unconfirmed. An unaddressable temporary workspace may expire by its idle limit." }); }
		finally {
			if (this.current(controller, revision)) this.active = null;
			this.publish({ ...this.state, creationPending: false, phase: this.state.phase === "stopping" ? "idle" : this.state.phase });
		}
	}
	async run(context: ReviewContext, mode: ReviewMode, prompt: string) {
		if (!this.state.executionEnabled || !this.state.models.includes(context.model) || !this.state.workspace || this.state.quarantined || this.state.requiresReset) return;
		const key = JSON.stringify([context.model, context.inputContextTokens, context.sessionUuid, context.compactionMode, mode]);
		if (this.conversationKey && this.conversationKey !== key) { this.publish({ ...this.state, error: "Start a fresh sandbox before changing this conversation's model, context or mode. Previous permissions are never transferred." }); return; }
		if (this.conversation.length >= 16) { this.publish({ ...this.state, error: "Conversation turn limit reached. Export/review your work and start a fresh sandbox." }); return; }
		const workspace = this.state.workspace; const models = this.state.models;
		const job = this.begin("running"); if (!job) return;
		this.conversationKey = key;
		const { controller, revision } = job; this.publish({ ...this.state, events: [...this.state.events, { kind: "user.message", text: prompt }].slice(-256) as AgentLoopEvent[] });
		const services = new HostedAgentServices(workspace, models, this.consent, this.io, value => this.discard(value), this.questions);
		let completed = false; let next: typeof this.queued = null;
		try {
			for await (const event of new NativeAgentLoop(services).run({ ...context }, mode, prompt, controller.signal, this.conversation)) {
				if (!this.current(controller, revision)) break;
				if (event.kind === "finished") { this.conversation.push(event.conversationTurn); completed = true; }
				this.publish({ ...this.state, events: [...this.state.events, event].slice(-256) });
			}
			if (!this.current(controller, revision)) return;
			const final = this.state.events.at(-1);
			this.publish({ ...this.state, phase: final?.kind === "finished" ? "complete" : "failed", pendingApproval: null, pendingQuestion: null, conversationTurns: this.conversation.length, requiresReset: !completed,
				workspace: services.invalidated ? null : workspace, quarantined: services.invalidated && !services.discardConfirmed ? workspace : null,
				error: final?.kind === "stopped" ? final.message : final?.kind === "finished" ? "" : "Agent run did not record a completion." });
		} catch { if (this.current(controller, revision)) this.publish({ ...this.state, phase: "failed", pendingApproval: null, pendingQuestion: null, requiresReset: true,
			workspace: services.invalidated ? null : workspace, quarantined: services.invalidated && !services.discardConfirmed ? workspace : null, error: "Agent run stopped or failed. No automatic retry was attempted." }); }
		finally { if (this.current(controller, revision)) {
			this.consent.clear(); this.questions.dismiss(); this.active = null;
			next = completed ? this.queued : null; this.queued = null;
			this.state = freeze({ ...this.state, queuedPrompt: null });
			if (!next) this.publish(this.state);
		} }
		if (next) await this.run(next.context, next.mode, next.prompt);
	}
	queueFollowUp(context: ReviewContext, mode: ReviewMode, prompt: string): boolean {
		if (!this.active || !["running", "awaiting_approval", "awaiting_question"].includes(this.state.phase) || this.queued ||
			JSON.stringify([context.model, context.inputContextTokens, context.sessionUuid, context.compactionMode, mode]) !== this.conversationKey) return false;
		try { buildProposalReview(context, mode, prompt); } catch { return false; }
		this.queued = { context: { ...context }, mode, prompt }; this.publish({ ...this.state, queuedPrompt: prompt }); return true;
	}
	cancelQueued = () => { this.queued = null; this.publish({ ...this.state, queuedPrompt: null }); };
	decide = (id: string, approved: boolean) => this.consent.decide(id, approved);
	answer = (decision: unknown) => this.questions.answer(decision);
	private async discard(workspace: AgentWorkspace) {
		if (this.cleanup?.id === workspace.id) return this.cleanup.promise;
		const promise = (async () => {
			const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), 10_000);
			try { const reply = await this.io.json(`/api/playground/sandbox/${workspace.id}`, "DELETE", undefined, timeout.signal, 10_000, false); return reply.stopped === true; }
			catch { return false; } finally { clearTimeout(timer); }
		})();
		this.cleanup = { id: workspace.id, promise };
		const confirmed = await promise;
		if (!confirmed && this.cleanup?.promise === promise) this.cleanup = null;
		return confirmed;
	}
	async stop(clearCapabilities = false) {
		const hadWork = !!this.active || !!this.state.workspace || !!this.state.quarantined || this.state.conversationTurns > 0;
		const workspace = this.state.workspace ?? this.state.quarantined; const revision = ++this.revision;
		this.active?.abort(); this.active = null; this.consent.clear(); this.questions.dismiss(); this.conversation = []; this.conversationKey = null; this.queued = null;
		this.publish({ ...this.state, phase: workspace || this.state.creationPending ? "stopping" : "idle", workspace: null, quarantined: workspace, pendingApproval: null, pendingQuestion: null, conversationTurns: 0, requiresReset: false, queuedPrompt: null, events: [],
			...(clearCapabilities ? { models: [], executionEnabled: false } : {}), error: "" });
		const confirmed = workspace ? await this.discard(workspace) : true;
		if (this.revision === revision && !this.disposed) this.publish({ ...this.state, phase: this.state.creationPending ? "stopping" : confirmed ? "idle" : "failed", quarantined: confirmed ? null : workspace,
			error: this.state.creationPending ? "Cancelling sandbox startup; waiting for its response before another workspace can start." : confirmed ? hadWork ? "Stopped and discarded. Model tokens may still have been billed." : "" : "Workspace removal could not be confirmed. Do not reuse it; retry discard or contact an operator." });
	}
	dispose() { void this.stop(true); this.disposed = true; this.unsubscribe(); this.unsubscribeQuestions(); }
}

export function agentResultText(invocation: AgentInvocation) {
	return `${invocation.refused ? "Refused" : `Exit ${invocation.result.exitCode}`} · ${Math.round(invocation.durationMs)} ms${invocation.truncated ? " · output clipped" : ""}\n${invocation.result.stdout}${invocation.result.stderr ? "\n[stderr]\n" + invocation.result.stderr : ""}`;
}
