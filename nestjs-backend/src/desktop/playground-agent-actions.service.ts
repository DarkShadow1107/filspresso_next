import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import * as crypto from "crypto";
import { DatabaseService } from "../database/database.service";
import { PlaygroundAgentTicketsService, actionDigest, executableCall } from "./playground-agent-tickets.service";
import { PlaygroundSandboxService } from "./playground-sandbox.service";
import { PlaygroundRunEventsService, type RunEventKind } from "./playground-run-events.service";
import { DesktopWebService } from "./desktop-web.service";
import { sanitizeSearchResults } from "./playground-chat-tools";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
type ActionRow = { action_id: string; account_id: string | number; model_run_id: string; execution_run_id: string; session_uuid: string | null;
	scope: "desktop" | "playground"; model_key: string; sandbox_id: string; tool_call_id: string; tool_name: string; arguments_sha256: string;
	mode: "plan" | "build"; effect: "read_only" | "mutation" | "execution"; status: string; expires_at: Date | string };

@Injectable()
export class PlaygroundAgentActionsService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(PlaygroundAgentActionsService.name);
	private sweepTimer?: ReturnType<typeof setInterval>;
	private readonly records = new Map<string, Promise<void>>();
	constructor(private readonly db: DatabaseService, private readonly tickets: PlaygroundAgentTicketsService,
		private readonly sandboxes: PlaygroundSandboxService, private readonly events: PlaygroundRunEventsService, private readonly web?: DesktopWebService) {}
	onModuleInit() { this.sweepTimer = setInterval(() => { void this.sweep(); }, 60 * 60_000); this.sweepTimer.unref(); }
	onModuleDestroy() { if (this.sweepTimer) clearInterval(this.sweepTimer); }
	private async sweep() {
		const configured = Number.parseInt(process.env.PLAYGROUND_RUN_EVENT_RETENTION_DAYS || "7", 10);
		const days = Number.isFinite(configured) ? Math.max(1, Math.min(365, configured)) : 7;
		try { await this.db.getPool().query(`DELETE FROM playground_agent_actions WHERE action_id IN
			(SELECT action_id FROM playground_agent_actions WHERE created_at<NOW()-($1::int*INTERVAL '1 day') ORDER BY created_at LIMIT 500)`, [days]); }
		catch { this.logger.warn("Agent action metadata retention sweep unavailable."); }
	}
	private enabled() { if (!this.tickets.configured()) throw new ServiceUnavailableException({ error: "AGENT_EXECUTION_DISABLED" }); }
	private record(row: ActionRow, kind: RunEventKind, extra: Record<string, unknown> = {}, status: "pending" | "complete" | "failed" = "pending") {
		// Serialize this action's fail-open facts so first-use sequence seeding cannot race
		// approval/start/completion writes. Never hold dispatch open waiting on observability.
		const previous = this.records.get(row.execution_run_id) ?? Promise.resolve();
		const next = previous.then(() => this.events.record(Number(row.account_id), row.execution_run_id, kind, { sessionUuid: row.session_uuid, modelKey: row.model_key,
			scope: row.scope, status, payload: { action_id: row.action_id, model_run_id: row.model_run_id, sandbox_id: row.sandbox_id,
				tool_call_id: row.tool_call_id, name: row.tool_name, effect: row.effect, ...extra } })).catch(() => { this.logger.warn("Agent action event unavailable."); });
		this.records.set(row.execution_run_id, next);
		void next.then(() => { if (this.records.get(row.execution_run_id) === next) this.records.delete(row.execution_run_id); });
	}
	async capabilities(account: number, signal?: AbortSignal) {
		if (!this.tickets.configured()) return { version: 1, enabled: false, protocol: "actions-v1", location: "hosted-docker" };
		try {
			const health = await this.sandboxes.request(account, "GET", "/health", undefined, signal);
			return { version: 1, enabled: health.available === true && health.location === "hosted-docker" && health.network === "disabled" && health.policyVersion === 2 && health.descendantPolicy === "freeze-check-discard", protocol: "actions-v1", location: "hosted-docker" };
		} catch { return { version: 1, enabled: false, protocol: "actions-v1", location: "hosted-docker" }; }
	}
	async prepare(account: number, raw: unknown, signal?: AbortSignal) {
		this.enabled();
		if (!object(raw) || Object.keys(raw).some(key => !["ticket", "sandboxId", "call"].includes(key)) || typeof raw.sandboxId !== "string" || !UUID.test(raw.sandboxId)) throw new BadRequestException({ error: "INVALID_AGENT_ACTION" });
		let verified;
		try { verified = this.tickets.verify(raw.ticket, account, raw.call); } catch { throw new BadRequestException({ error: "INVALID_MODEL_ACTION_TICKET" }); }
		const { claims, proposal } = verified;
		const owned = await this.sandboxes.request(account, "GET", `/sandboxes/${raw.sandboxId}`, undefined, signal);
		if (owned.id !== raw.sandboxId || owned.location !== "hosted-docker" || owned.policyVersion !== 2) throw new ServiceUnavailableException({ error: "AGENT_SANDBOX_NOT_QUALIFIED" });
		signal?.throwIfAborted();
		// The UNIQUE account/model-run/call key makes even concurrent prepare requests
		// converge on one action. No source/arguments are retained, only their signed digest.
		const inserted = await this.db.getPool().query<ActionRow>(`INSERT INTO playground_agent_actions
			(action_id, account_id, model_run_id, execution_run_id, session_uuid, scope, model_key, sandbox_id, tool_call_id, tool_name, arguments_sha256, mode, effect, expires_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TO_TIMESTAMP($14))
			ON CONFLICT (account_id, model_run_id, tool_call_id) DO NOTHING RETURNING *`,
			[crypto.randomUUID(), account, claims.run, "exec-" + crypto.randomBytes(12).toString("hex"), claims.session, claims.scope, claims.model,
				raw.sandboxId, proposal.call.id, proposal.call.name, claims.digest, claims.mode, proposal.effect, claims.expires]);
		const row = inserted.rows[0] ?? (await this.db.getPool().query<ActionRow>(`SELECT * FROM playground_agent_actions WHERE account_id=$1 AND model_run_id=$2 AND tool_call_id=$3`, [account, claims.run, proposal.call.id])).rows[0];
		if (!row || row.status !== "pending" || row.sandbox_id !== raw.sandboxId || row.arguments_sha256 !== claims.digest || row.tool_name !== proposal.call.name || new Date(row.expires_at).getTime() <= Date.now()) throw new ConflictException({ error: "AGENT_ACTION_ALREADY_USED" });
		return { version: 1, actionId: row.action_id, runId: row.execution_run_id, sandboxId: row.sandbox_id, toolCallId: row.tool_call_id,
			requiresApproval: row.effect !== "read_only" || row.tool_name === "web_search", expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000) };
	}
	async execute(account: number, id: string, raw: unknown, signal?: AbortSignal) {
		this.enabled();
		if (!UUID.test(id) || !object(raw) || Object.keys(raw).some(key => !["approved", "call", "sandboxId"].includes(key)) || typeof raw.approved !== "boolean" || typeof raw.sandboxId !== "string" || !UUID.test(raw.sandboxId)) throw new BadRequestException({ error: "INVALID_AGENT_DECISION" });
		const found = await this.db.getPool().query<ActionRow>("SELECT * FROM playground_agent_actions WHERE action_id=$1 AND account_id=$2", [id, account]);
		const previous = found.rows[0]; if (!previous) throw new NotFoundException();
		let proposal;
		try { proposal = executableCall(raw.call, previous.mode); } catch { throw new BadRequestException({ error: "INVALID_AGENT_ACTION" }); }
		if (previous.scope === "playground" && proposal.call.name === "run_command") throw new BadRequestException({ error: "WEB_AGENT_COMMANDS_DISABLED" });
		if (!this.tickets.modelEnabled(previous.model_key) || previous.sandbox_id !== raw.sandboxId || previous.tool_call_id !== proposal.call.id || previous.tool_name !== proposal.call.name || previous.effect !== proposal.effect || previous.arguments_sha256 !== actionDigest(proposal.call)) throw new ConflictException({ error: "AGENT_ACTION_CHANGED" });
		if (raw.approved) {
			const owned = await this.sandboxes.request(account, "GET", `/sandboxes/${previous.sandbox_id}`, undefined, signal);
			if (owned.id !== previous.sandbox_id || owned.policyVersion !== 2) throw new ConflictException({ error: "AGENT_WORKSPACE_CHANGED" });
		}
		signal?.throwIfAborted();
		// This atomic transition is the dispatch authority. It is NOT the fail-open event
		// recorder. A second click/process/retry can never claim the same proposal again.
		const claimed = await this.db.getPool().query<ActionRow>(`UPDATE playground_agent_actions SET status=$3,
			finished_at=CASE WHEN $3='declined' THEN NOW() ELSE NULL END
			WHERE action_id=$1 AND account_id=$2 AND status='pending' AND expires_at>NOW()
			AND sandbox_id=$4 AND arguments_sha256=$5 RETURNING *`, [id, account, raw.approved ? "executing" : "declined", previous.sandbox_id, previous.arguments_sha256]);
		const row = claimed.rows[0]; if (!row) throw new ConflictException({ error: "AGENT_ACTION_ALREADY_USED" });
		if (!raw.approved) {
			this.record(row, "tool.declined", { approved: false, authority: "authenticated_client_decision", executed: false }, "complete");
			return { version: 1, actionId: id, status: "declined", executed: false };
		}
		this.record(row, "tool.approval", { approved: true, authority: row.effect === "read_only" && row.tool_name !== "web_search" ? "plan_build_read_policy" : "authenticated_client_decision" });
		let dispatched = false;
		try {
			signal?.throwIfAborted();
			dispatched = true; const started = performance.now();
			this.record(row, "tool.started", { authority: "server_dispatch" });
			let result: { stdout: string; stderr: string; exitCode: number; timedOut: boolean; durationMs?: number };
			if (proposal.call.name === "web_search") {
				try {
					if (!this.web) throw new Error("Web search is unavailable.");
					const results = sanitizeSearchResults(await this.web.search(proposal.args.query, 5));
					result = { stdout: JSON.stringify({ results }), stderr: "", exitCode: 0, timedOut: false };
				} catch {
					signal?.throwIfAborted();
					result = { stdout: "", stderr: "Web search is unavailable or the provider refused this request.", exitCode: 1, timedOut: false };
				}
			}
			else if (proposal.call.name === "run_command") result = await this.sandboxes.agentCommand(account, row.sandbox_id, proposal.args.command, signal);
			else if (proposal.call.name === "read_file") {
				try {
					const body = await this.sandboxes.request(account, "GET", `/sandboxes/${row.sandbox_id}/file?${new URLSearchParams({ path: proposal.args.path })}`, undefined, signal);
					if (body.path !== proposal.args.path || typeof body.text !== "string" || Buffer.byteLength(body.text, "utf8") > 262_144) throw new Error("Invalid file read receipt.");
					result = { stdout: body.text, stderr: "", exitCode: 0, timedOut: false };
				} catch (error) {
					if (!(error instanceof HttpException) || error.getStatus() !== 400) throw error;
					result = { stdout: "", stderr: "Read refused: file is missing, binary, too large or not a regular workspace file.", exitCode: 1, timedOut: false };
				}
			} else {
				const body = await this.sandboxes.request(account, "PUT", `/sandboxes/${row.sandbox_id}/file`, { path: proposal.args.path, text: proposal.args.text }, signal);
				if (body.path !== proposal.args.path || body.bytes !== Buffer.byteLength(proposal.args.text, "utf8")) throw new Error("Invalid file write receipt.");
				result = { stdout: "Workspace file saved.", stderr: "", exitCode: 0, timedOut: false };
			}
			signal?.throwIfAborted();
			if (result.timedOut) throw new Error("Workload was stopped or did not quiesce.");
			const durationMs = Math.round(performance.now() - started);
			const committed = await this.db.getPool().query("UPDATE playground_agent_actions SET status='complete', finished_at=NOW() WHERE action_id=$1 AND account_id=$2 AND status='executing' RETURNING action_id", [id, account]);
			if (!committed.rows[0]) throw new Error("Outcome could not be committed.");
			this.record(row, "tool.finished", { authority: "broker_observed", exit_code: result.exitCode, duration_ms: durationMs, executed: true }, "complete");
			const outBudget = 16_000 - Math.min(result.stderr.length, 8000);
			const clip = (text: string, budget: number) => { let value = text.slice(0, budget); if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1); return value; };
			const stdout = clip(result.stdout, outBudget), stderr = clip(result.stderr, 16_000 - outBudget);
			return { version: 1, actionId: id, runId: row.execution_run_id, sandboxId: row.sandbox_id, toolCallId: row.tool_call_id, status: "complete", executed: true,
				result: { stdout, stderr, exitCode: result.exitCode, timedOut: false, durationMs, truncated: stdout !== result.stdout || stderr !== result.stderr } };
		} catch {
			let discarded = false;
			if (dispatched) {
				const cleanup = new AbortController(); const timer = setTimeout(() => cleanup.abort(), 10_000);
				try { const reply = await this.sandboxes.request(account, "DELETE", `/sandboxes/${row.sandbox_id}`, undefined, cleanup.signal); discarded = reply.stopped === true; }
				catch { /* Never assert teardown from an unavailable/ambiguous ownership read. */ }
				finally { clearTimeout(timer); }
			}
			try { await this.db.getPool().query("UPDATE playground_agent_actions SET status='failed', finished_at=NOW() WHERE action_id=$1 AND account_id=$2 AND status='executing'", [id, account]); } catch { /* The one-shot executing claim remains non-reusable. */ }
			this.record(row, "tool.failed", { reason: "execution_or_confirmation_unavailable", dispatched, teardown_confirmed: discarded }, "failed");
			throw new ServiceUnavailableException({ error: "AGENT_ACTION_INTERRUPTED", message: "Action interrupted or unconfirmed. No automatic retry is permitted.", teardownConfirmed: discarded });
		}
	}
}
