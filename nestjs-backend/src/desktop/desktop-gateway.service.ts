import { Injectable, Logger } from "@nestjs/common";
// Aliased, because bare `Response` is the WHATWG fetch response and this file
// uses both: the fetch result it proxies from, and the express response it writes to.
import type { Response as ExpressResponse } from "express";
import * as crypto from "crypto";
import { BillingService } from "../billing/billing.service";
import { AddonsService } from "../billing/addons.service";
import { canUseSpectre } from "../billing/tier-allowance";
import { playgroundModelFile, playgroundTextModelKeys } from "./text-models";
import { fetchBounded } from "../common/utils/httpClient";
import { AGENT_MAX_BYTES, AGENT_TIMEOUT_MS, agentUsage, validateAgentReply, validateAgentRequest, type AgentReply, type AgentRequest } from "./playground-agent-contract";
import { desktopModelAccess } from "./desktop-policy";
import { readInputContext } from "./input-context";
import { PlaygroundRunEventsService, type RunEventKind, type RunEventStatus, normalizeSessionUuid } from "./playground-run-events.service";
import { PlaygroundAgentTicketsService, type ActionTicket } from "./playground-agent-tickets.service";
import { DesktopWebService } from "./desktop-web.service";
import { PlaygroundDocumentsService } from "./playground-documents.service";
import { appendBoundedSystemPrompt, extractPlaygroundDocuments, webResearchRequested } from "./playground-chat-tools";

/** Mirrors the web route's clamps, so the two surfaces cannot disagree on what is legal. */
const MAX_MESSAGE_LENGTH = 8000;
const MAX_SYSTEM_PROMPT_LENGTH = 2000;
// Legacy output API ceiling; the native input dropdown is validated separately.
const MAX_MAX_TOKENS = 131_072;
const DEFAULT_MAX_TOKENS = 2048;
const MAX_TEMPERATURE = 2;
const DEFAULT_TEMPERATURE = 0.7;
/** Cap on the streamed answer kept only to scan for document fences. */
const REPLY_SCAN_LIMIT = 240_000;
/**
 * The standing instruction that makes one chat turn able to produce a document. Playground
 * scope only: the desktop client has no document surface to download from yet.
 */
const DOCUMENT_INSTRUCTION = [
	"You can also leave the user a file. When the user's request asks for something to keep -- a document, essay, report, plan, list, recipe, or any long structured answer -- write the complete markdown body once inside this exact fence:",
	"      [[document: A short title]]",
	"      ...the full markdown body...",
	"      [[/document]]",
	"Do not wrap code blocks inside the fence's name line, and do not write anything after the closing line inside the fence. Keep replying normally in the chat too: the conversation text stays visible, and the fence becomes a downloadable file.",
].join("\n");

export type DesktopStreamResult = StreamRefusal | { kind: "sent"; requestId: string };

/** The shape every refusal has; naming it lets the gate hand one back without a widening. */
export type StreamRefusal = { kind: "refused"; status: number; error: string; message: string };
export type AgentTurnResult = (StreamRefusal & { requestId?: string }) | { kind: "completed"; requestId: string; payload: AgentReply & { runId: string; settlement: "succeeded"; action_tickets?: ActionTicket[] } };

/** A durable payload: always scalars and small collections, never history text. */
type RecordOptions = {
	scope?: "desktop" | "playground";
	payload?: unknown;
	sessionUuid?: string | null;
	modelKey?: string | null;
	status?: RunEventStatus;
};

/**
 * Shared metered inference for desktop and web Playground clients.
 *
 * This exists because there was nowhere else for a native client to send a request. The web
 * Playground formerly called Python directly. Both clients now use this gateway: the
 * backend owns entitlement, affordability and settlement, and internal inference carries
 * the AI service key. Native tool proposals use a separate, default-disabled turn contract.
 *
 * So the order of operations is the whole design, and it is deliberately the order the
 * authoritative Kafelot choke point uses (`kafelot.controller.ts:188-211`):
 *
 *   1. authenticate            -- the guard; a bearer token, no cookie
 *   2. validate the request     -- cheap, and before anything expensive
 *   3. resolve entitlement      -- does this account have the Playground at all
 *   4. money gate              -- can it pay, *before* the model is loaded
 *   5. stream                  -- only now does a GPU do work
 *   6. meter on the done frame -- with an idempotency key
 *
 * Step 4 before step 5 is the part that matters most. Serving first and charging afterwards
 * means a customer with no money still consumed the inference, and it is the reason the
 * allowance check moved ahead of generation in the first place.
 */
@Injectable()
export class DesktopGatewayService {
	private readonly logger = new Logger(DesktopGatewayService.name);

	// The event recorder is optional on purpose: a stream that cannot record must still
	// stream, and every existing test that constructs this service by hand keeps working.
	// The module injects it when available; the service's own record() never throws into a
	// stream path either way.
	constructor(
		private readonly billing: BillingService,
		private readonly addons: AddonsService,
		private readonly events?: PlaygroundRunEventsService,
		private readonly actionTickets?: PlaygroundAgentTicketsService,
		// Optional like the recorder: hand-constructed services in tests keep every
		// existing arity working, and a stream that cannot reach either helper must still
		// stream -- grounding degrades to plain generation, documents degrade to text.
		_web?: DesktopWebService,
		private readonly documents?: PlaygroundDocumentsService,
	) {}

	/** One durable entry. Fire and move on: the recorder has the fail-open contract. */
	private record(accountId: number, runId: string, kind: RunEventKind, options: RecordOptions = {}): void {
		try { void Promise.resolve(this.events?.record(accountId, runId, kind, options)).catch(() => this.logger.warn("Run event recording failed.")); }
		catch { this.logger.warn("Run event recording failed."); }
	}

	/** Explicit operator-qualified transport allowlist. Empty by default; never inferred from text. */
	agentModels(): string[] {
		if (!process.env.AI_SERVICE_KEY?.trim()) return [];
		const files = new Set((process.env.PLAYGROUND_AGENT_MODEL_FILES || "").split(",").map(file => file.trim()).filter(Boolean));
		return playgroundTextModelKeys().filter(key => files.has(playgroundModelFile(key)!));
	}

	/** One terminal native turn. It proposes actions but has no executor, approval, or host shell. */
	async agentTurn(accountId: number, tier: string, raw: unknown, scope: "desktop" | "playground", signal?: AbortSignal): Promise<AgentTurnResult> {
		let request: AgentRequest;
		try { request = validateAgentRequest(raw); }
		catch { return { kind: "refused", status: 400, error: "INVALID_AGENT_CONTRACT", message: "Invalid or oversized native agent request." }; }
		if (!this.agentModels().includes(request.model)) return { kind: "refused", status: 503, error: "AGENT_DISABLED", message: "This model has no operator-qualified native tool transport. Plain chat remains available." };
		const requestId = `dsk-${crypto.randomBytes(12).toString("hex")}`;
		const options = { sessionUuid: request.session_uuid ?? null, modelKey: request.model, scope };
		const refusal = (status: number, error: string, message: string): AgentTurnResult => {
			this.record(accountId, requestId, "generation.refused", { ...options, payload: { protocol: "native-v1", error, status } });
			return { kind: "refused", requestId, status, error, message };
		};
		const gate = await this.refuse(accountId, tier, request.model);
		if (gate.refusal) return refusal(gate.refusal.status, gate.refusal.error, gate.refusal.message);
		if (signal?.aborted) return refusal(503, "AGENT_CANCELLED", "The agent turn was cancelled.");
		this.record(accountId, requestId, "generation.started", { ...options, payload: { protocol: "native-v1", mode: request.mode, scope, tool_count: request.tools.length, round: request.history.length } });
		let response: Response; let body: unknown;
		try {
			response = await fetchBounded(`${this.aiHost()}/api/playground/agent/turn`, {
				method: "POST", headers: { ...this.upstreamHeaders(), Accept: "application/json" }, signal,
				timeoutMs: AGENT_TIMEOUT_MS, maxBytes: AGENT_MAX_BYTES, redirect: "error",
				body: JSON.stringify({ ...request, text_model: playgroundModelFile(request.model), request_id: requestId }),
			});
			body = await response.json();
		} catch { return refusal(503, "AGENT_UNAVAILABLE", "Native agent transport failed or was cancelled. No automatic retry was attempted."); }
		const document = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
		const compaction = document.compaction && typeof document.compaction === "object" ? document.compaction as Record<string, unknown> : {};
		const summaryUsage = agentUsage(response.ok ? compaction.usage : document.compaction_usage);
		const totalUsage = agentUsage(document.usage);
		const usage = response.ok && summaryUsage && totalUsage ? agentUsage({ prompt_tokens: totalUsage.prompt_tokens - summaryUsage.prompt_tokens,
			completion_tokens: totalUsage.completion_tokens - summaryUsage.completion_tokens }) : totalUsage;
		let settlementFailed = false;
		if (summaryUsage) {
			try {
				await this.billing.recordUsage({ accountId, tier, modelKey: request.model, scope, accessSource: gate.accessSource, requestId: `${requestId}-compaction`,
					usage: { inputTokens: summaryUsage.prompt_tokens, outputTokens: summaryUsage.completion_tokens } });
				this.record(accountId, requestId, "settlement.succeeded", { ...options, payload: { scope: "compaction", ...summaryUsage } });
			} catch {
				settlementFailed = true;
				this.record(accountId, requestId, "settlement.failed", { ...options, status: "failed", payload: { scope: "compaction", reason: "record_usage_failed" } });
			}
		}
		// Even an invalid/truncated native answer can consume model tokens. Settle reported
		// work once, but never release proposals after a failed settlement or invalid reply.
		if (usage) {
			this.record(accountId, requestId, "generation.finished", { ...options, payload: { protocol: "native-v1", usage_reported: true, ...usage } });
			try {
				await this.billing.recordUsage({ accountId, tier, modelKey: request.model, scope, accessSource: gate.accessSource, requestId,
					usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } });
				this.record(accountId, requestId, "settlement.succeeded", { ...options, payload: { scope: "generation", ...usage } });
			} catch {
				settlementFailed = true;
				this.record(accountId, requestId, "settlement.failed", { ...options, status: "failed", payload: { scope: "generation", reason: "record_usage_failed" } });
				// The MODEL work completed; a failed charge must not rewrite that fact as a
				// generation failure in replay. The API still fails closed before proposals.
			}
		}
		if (settlementFailed) return { kind: "refused", requestId, status: 503, error: "BILLING_UNAVAILABLE", message: "The agent turn could not be settled. No tool proposal was released." };
		if (!response.ok) {
			const status = response.status === 400 || response.status === 413 ? response.status : response.status === 429 || response.status === 503 ? 503 : 502;
			return refusal(status, document.error === "AGENT_DISABLED" ? "AGENT_DISABLED" : document.error === "MODEL_BUSY" ? "MODEL_BUSY" : "AGENT_TURN_FAILED",
				"Native agent turn was refused or invalid. No proposal was released. Context/tool pairs were not silently dropped.");
		}
		let reply: AgentReply;
		try { reply = validateAgentReply(document, request); }
		catch { return refusal(502, "INVALID_AGENT_RESPONSE", "The native response was invalid or unmetered. No tool proposal was released."); }
		if (reply.compaction?.compacted) this.record(accountId, requestId, "context.compacted", { ...options, payload: { protocol: "native-v1", mode: reply.compaction.mode,
			input_limit: reply.compaction.inputLimit, tokens_before: reply.compaction.tokensBefore, tokens_after: reply.compaction.tokensAfter, consumed_groups: reply.compaction.consumedGroups } });
		if (signal?.aborted) return refusal(503, "AGENT_CANCELLED", "The agent turn was cancelled after generation.");
		for (const call of reply.tool_calls) this.record(accountId, requestId, "tool.proposed", { ...options,
			payload: { tool_call_id: call.id, name: call.name, argument_bytes: Buffer.byteLength(call.arguments, "utf8"), executed: false, mode: request.mode } });
		const tickets = this.actionTickets?.issue(accountId, request, reply, requestId, scope) ?? [];
		return { kind: "completed", requestId, payload: { ...reply, runId: requestId, settlement: "succeeded", ...(tickets.length ? { action_tickets: tickets } : {}) } };
	}

	/** Where the AI service lives. In-network by name; loopback when the backend runs bare. */
	private aiHost(): string {
		const configured = String(process.env.PYTHON_AI_HOST || "").trim();
		return (configured || "http://ai:5000").replace(/\/+$/, "");
	}

	/**
	 * Headers for a call to the AI service.
	 *
	 * The service key is sent only when one is configured. Sending an empty one would be
	 * worse than sending none: it looks like an attempt to authenticate, and a future
	 * version of the service that compared an absent header differently from an empty one
	 * would refuse this call while every other caller carried on working.
	 */
	private upstreamHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		};
		const key = String(process.env.AI_SERVICE_KEY || "").trim();
		if (key) headers["x-ai-service-key"] = key;
		return headers;
	}

	private clampNumber(value: unknown, min: number, max: number, fallback: number): number {
		const n = Number(value);
		if (!Number.isFinite(n)) return fallback;
		return Math.min(max, Math.max(min, n));
	}

	private clampText(value: unknown, max: number): string {
		return typeof value === "string" ? value.slice(0, max) : "";
	}

	/**
	 * Refusals, kept as data so the caller can turn one into a response without this method
	 * needing to know about HTTP.
	 *
	 * 402 and 503 are different on purpose. "You cannot pay" is the customer's problem;
	 * "we could not find out whether you can pay" is ours, and answering 402 to a billing
	 * outage sends a paying customer to top up a wallet that is not the problem.
	 */
	private async refuse(
		accountId: number,
		tier: string,
		modelKey: string,
	): Promise<{ refusal: StreamRefusal; accessSource: "addon" | "tier" | null } | { refusal: null; accessSource: "addon" | "tier" | null }> {
		let accessSource: "addon" | "tier" | null = null;
		try {
			const access = await this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier));
			accessSource = access.source;
			if (!access.hasAccess) {
				return {
					accessSource,
					refusal: {
						kind: "refused",
						status: 403,
						error: "PLAYGROUND_LOCKED",
						message: "The Playground needs the Spectre subscription or a Max/Ultimate plan.",
					},
				};
			}

			// Per-model affordability, from the same policy the charge is resolved with.
			//
			// A plain "can this account afford anything" check is not enough here. An add-on
			// holder cannot spend their plan allowance on the Playground -- the subscription buys
			// access, not usage -- and Max cannot pay for the 8B out of its allowance. Deciding
			// it in one place keeps the catalogue and the gate from disagreeing.
			const [balance, allowance] = await Promise.all([
				this.billing.getBalance(accountId),
				this.billing.getAllowance(accountId, tier),
			]);
			const gate = desktopModelAccess({
				modelKey,
				tier,
				accessSource,
				walletCanGenerate: balance.canGenerate,
				allowanceRemainingRon: allowance.remainingRon,
			});
			if (!gate.canGenerate) {
				return {
					accessSource,
					refusal: {
						kind: "refused",
						status: 402,
						error: "INSUFFICIENT_BALANCE",
						message: "Your monthly allowance and Playground balance are both spent.",
					},
				};
			}
		} catch (err) {
			// Fail closed. An unreachable billing service must not become a free generation.
			this.logger.error(`desktop money gate failed for account ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
			return {
				accessSource,
				refusal: {
					kind: "refused",
					status: 503,
					error: "BILLING_UNAVAILABLE",
					message: "We could not check your balance right now. Please try again in a moment.",
				},
			};
		}
		return { refusal: null, accessSource };
	}

	/**
	 * Stream one generation, and meter it.
	 *
	 * `requestId` is generated here rather than accepted from the client. The client has no
	 * reason to choose it and every reason to reuse one: a stable key is exactly what makes
	 * the report idempotent, and a client-supplied value would let a retry be shaped to look
	 * like a different request. Both clients receive the same server-owned ID contract.
	 */
	async streamChat(
		res: ExpressResponse,
		accountId: number,
		tier: string,
		body: Record<string, unknown>,
		scope: "desktop" | "playground" = "desktop",
	): Promise<DesktopStreamResult> {
		const modelKey = String(body?.model ?? body?.modelKey ?? "").trim();
		const modelFile = playgroundModelFile(modelKey);
		if (!modelFile) {
			return {
				kind: "refused",
				status: 400,
				error: "UNKNOWN_MODEL",
				message: "That model is not available in the Playground.",
			};
		}

		const message = this.clampText(body?.message, MAX_MESSAGE_LENGTH).trim();
		if (!message) {
			return { kind: "refused", status: 400, error: "MESSAGE_REQUIRED", message: "message is required" };
		}
		let inputContext: Record<string, unknown> = {};
		try { inputContext = readInputContext(body); }
		catch (error) { return { kind: "refused", status: 400, error: "INVALID_INPUT_CONTEXT", message: error instanceof Error ? error.message : "Invalid input context." }; }

		// The run id is minted before the money gate, so every gate outcome has the same
		// shape a customer can replay. It is deliberately minted *after* the validation
		// checks above: a client that sent an impossible model or empty message gets its
		// 400 and nothing more -- durable history starts where the server starts spending.
		// Conversation linkage, if any, is validated client-supplied data -- an invalid uuid
		// means the events simply have none, never that a run is anonymous-but-guessable.
		const requestId = `dsk-${crypto.randomBytes(12).toString("hex")}`;
		const sessionUuid = normalizeSessionUuid(body?.session_uuid ?? body?.sessionUuid);
		// Collect every refusal through one helper so the durable record of "this run was
		// refused" can never drift from the refusal actually returned.
		const refusal = (status: number, error: string, message: string): DesktopStreamResult => {
			this.record(accountId, requestId, "generation.refused", { payload: { status, error, message, model: modelKey, scope }, sessionUuid, modelKey });
			return { kind: "refused", status, error, message };
		};
		if (webResearchRequested(body)) return refusal(400, "WEB_GROUNDING_REMOVED", "Automatic web grounding was removed. Use agent mode and approve a web search instead.");

		// Resolved once, then passed down explicitly. Holding it on the service instance would
		// be a race: Nest services are singletons, so two streams in flight would overwrite each
		// other's access source and one of them would be billed from the wrong pot -- an add-on
		// customer charged at their tier's allowance rate, or the reverse.
		const gate = await this.refuse(accountId, tier, modelKey);
		if (gate.refusal) return refusal(gate.refusal.status, gate.refusal.error, gate.refusal.message);
		const accessSource = gate.accessSource;

		// Thinking is restricted by plan, and it is decided from the server's own tier rather
		// than the request -- the same reasoning as the web route.
		const enableThinking = (body?.thinking === true || body?.thinking === "true") && this.tierAllowsThinking(tier);

		// An explicit AbortController rather than AbortSignal.timeout, to match how every
		// other service in this backend bounds its outbound calls (and to satisfy the
		// phase7-bounded-io invariant, which is right to insist that a timeout is visible in
		// the source rather than assumed).
		//
		// The bound is on the whole exchange, not on connect: a streaming generation legitimately
		// runs for minutes, and the thing that must never happen is a socket left open
		// indefinitely holding a connection from the pool.
		const upstreamController = new AbortController();
		res.once?.("close", () => upstreamController.abort());

		if (upstreamController.signal.aborted) return refusal(503, "STREAM_CANCELLED", "The stream was cancelled before generation.");

		// The client's own system prompt keeps its clamp; the document instruction is
		// appended server-side, and the whole composition keeps a bound
		// because a runaway system prompt would eat context the conversation needs.
		const clientSystemPrompt = this.clampText(body?.system_prompt ?? body?.systemPrompt, MAX_SYSTEM_PROMPT_LENGTH);
		let systemPrompt = clientSystemPrompt;
		if (scope === "playground") systemPrompt = appendBoundedSystemPrompt(systemPrompt, DOCUMENT_INSTRUCTION);

		// Recorded before the gateway call: a run that dies connecting is still a run.
		this.record(accountId, requestId, "generation.started", {
			payload: {
				model: modelKey,
				tier,
				scope,
				input_context_tokens: inputContext.input_context_tokens,
				compaction_mode: inputContext.compaction_mode,
				compact_now: inputContext.compact_now === true,
				thinking: enableThinking,
			},
			sessionUuid,
			modelKey,
		});

		const upstreamTimeout = setTimeout(
			() => upstreamController.abort(),
			Number(process.env.DESKTOP_STREAM_TIMEOUT_MS || "960000"),
		);

		let upstream: Response;
		try {
			upstream = await fetch(`${this.aiHost()}/api/chat/stream`, {
				method: "POST",
				headers: this.upstreamHeaders(),
				signal: upstreamController.signal,
				body: JSON.stringify({
					message,
					...inputContext,
					system_prompt: systemPrompt,
					text_model: modelFile,
					temperature: this.clampNumber(body?.temperature, 0, MAX_TEMPERATURE, DEFAULT_TEMPERATURE),
					max_tokens: Math.round(this.clampNumber(body?.max_tokens ?? body?.maxTokens, 1, MAX_MAX_TOKENS, DEFAULT_MAX_TOKENS)),
					enable_thinking: enableThinking,
					// Threaded into the AI service so its own logs can be correlated with the
					// charge. It is not the billing idempotency key, which is generated below.
					request_id: requestId,
				}),
			});
		} catch (err) {
			clearTimeout(upstreamTimeout);
			this.logger.error(`desktop upstream fetch failed for account ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
			return refusal(502, "UPSTREAM_UNAVAILABLE", "The model service could not be reached.");
		}

		if (!upstream.ok || !upstream.body) {
			clearTimeout(upstreamTimeout);
			const detail = await upstream.json().catch(() => ({})) as { message?: string; error?: string; compaction_usage?: unknown };
			if (detail.compaction_usage) await this.settleCompaction(detail.compaction_usage, accountId, tier, modelKey, requestId, accessSource, scope, sessionUuid);
			if (detail.error === "COMPACTION_UNAVAILABLE") return refusal(503, detail.error || "COMPACTION_UNAVAILABLE", detail.message || "Compaction failed; your original history was preserved.");
			if (upstream.status === 400 || upstream.status === 413) {
				return refusal(upstream.status, detail.error || "INPUT_CONTEXT_EXCEEDED", detail.message || "The selected input context was exceeded.");
			}

			// 429 from the model service means its single llama.cpp slot is busy -- usually
			// because a model swap is loading, which takes minutes. That is a retryable
			// condition and not a failure, and it gets its own code so the client can say
			// "the model is loading" rather than "the model service could not complete that
			// request". Collapsing the two would leave the user staring at an error while
			// the model finishes loading underneath them.
			if (upstream.status === 429) {
				this.logger.warn(`desktop model service is busy for account ${accountId}`);
				return refusal(503, "MODEL_BUSY", "The model is being loaded. Please try again in a moment.");
			}

			this.logger.warn(`desktop upstream returned HTTP ${upstream.status} for account ${accountId}`);
			return refusal(502, "UPSTREAM_ERROR", "The model service could not complete that request.");
		}

		res.status(200);
		res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
		res.setHeader("Cache-Control", "no-cache, no-transform");
		res.setHeader("Connection", "keep-alive");
		// Proxies buffer streamed responses unless told not to; the buffered version of a
		// token stream defeats the point of having one.
		res.setHeader("X-Accel-Buffering", "no");
		res.setHeader("x-filspresso-request-id", requestId);
		res.flushHeaders?.();

		// `await`ed before returning: the controller has already handed the socket over, and
		// the meter has to keep reading after this method's caller believes it is finished.
		try {
			await this.pipeAndMeter(res, upstream.body, accountId, tier, modelKey, requestId, accessSource, scope, sessionUuid);
		} finally {
			// Cleared here rather than left to fire: a five-minute timer outliving its request
			// keeps the controller and its closure alive for every concurrent stream.
			clearTimeout(upstreamTimeout);
		}
		return { kind: "sent", requestId };
	}

	/**
	 * Copy the upstream stream through, and bill on the frame that says the work finished.
	 *
	 * A frame can straddle two TCP reads, so a partial line is held between chunks. Dropping
	 * one would lose the done frame, and a lost done frame means a completed generation that
	 * nobody is charged for -- the customer got the tokens and the meter never saw them.
	 */
	private async pipeAndMeter(
		res: ExpressResponse,
		upstreamBody: ReadableStream<Uint8Array>,
		accountId: number,
		tier: string,
		modelKey: string,
		requestId: string,
		accessSource: "addon" | "tier" | null,
		scope: "desktop" | "playground" = "desktop",
		sessionUuid: string | null = null,
	): Promise<void> {
		const reader = upstreamBody.getReader();
		const decoder = new TextDecoder();
		let pending = "";
		let metered = false;
		let compactionMetered = false;
		let compactionRecorded = false;
		// The assembled answer, for document extraction. Scanning happens on the done frame,
		// when the whole answer is present, so a fence split across TCP reads parses the
		// same way one that arrived in a single chunk would. Capped: a bounded scan needs a
		// bounded buffer, and a longer answer changed nothing a document could keep.
		let answer = "";
		let documentsEmitted = false;

		const billIfDone = async (line: string) => {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data:")) return;
			const payload = trimmed.slice(5).trim();
			if (!payload || payload === "[DONE]") return;
			// The compaction block's field names are whatever the Python side chose to emit;
			// only the ones replay cares about are read, and everything is clamped on record.
			let event: { delta?: unknown; done?: boolean; usage?: unknown; context?: { usage?: unknown; compacted?: boolean; inputLimit?: unknown; tokensBefore?: unknown; tokensAfter?: unknown; summary?: unknown } };
			try {
				event = JSON.parse(payload) as typeof event;
			} catch {
				return;
			}
			if (typeof event.delta === "string" && answer.length <= REPLY_SCAN_LIMIT) answer += event.delta;
			if (event.done) {
				if (scope === "playground" && !documentsEmitted) {
					documentsEmitted = true;
					await this.emitReplyDocuments(res, accountId, requestId, sessionUuid, modelKey, answer);
				}
			}
			if (event.context) {
				// Recorded once per run, whether or not a summary actually came out: a run
				// whose compaction was attempted but found nothing older to fold is a
				// different replay from one that never tried.
				if (!compactionRecorded) {
					compactionRecorded = true;
					this.record(accountId, requestId, "context.compacted", {
						payload: {
							compacted: event.context.compacted === true,
							input_limit: event.context.inputLimit,
							tokens_before: event.context.tokensBefore,
							tokens_after: event.context.tokensAfter,
							summary: typeof event.context.summary === "string" ? event.context.summary : undefined,
						},
						sessionUuid,
						modelKey,
					});
				}
				if (event.context.usage && !compactionMetered) {
					compactionMetered = true;
					await this.settleCompaction(event.context.usage, accountId, tier, modelKey, requestId, accessSource, scope, sessionUuid);
				}
			}
			if (!event.done || metered) return;
			const usage = readUsageBlock(event.usage);
			// Finished is recorded even when the usage block never arrived: done is a fact
			// about the generation, and a run that shows completed without settlement is a
			// different diagnostic from one that shows neither.
			if (!usage || (usage.inputTokens <= 0 && usage.outputTokens <= 0)) {
				this.record(accountId, requestId, "generation.finished", { payload: { usage_reported: false }, sessionUuid, modelKey });
				return;
			}
			this.record(accountId, requestId, "generation.finished", { payload: { usage_reported: true, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens }, sessionUuid, modelKey });
			metered = true;
			try {
				await this.billing.recordUsage({
					accountId,
					modelKey,
					usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
					scope,
					// Supplied from the server's own resolution, never from the request. The pot
					// depends on which product granted access: an add-on holder pays from the
					// wallet alone, and a Max customer draws on their allowance.
					tier,
					accessSource,
					// The idempotency key. Same value as the header the client was given, so a
					// retried report for this stream cannot charge twice.
					requestId,
				});
				this.record(accountId, requestId, "settlement.succeeded", { payload: { scope: "generation", input_tokens: usage.inputTokens, output_tokens: usage.outputTokens }, sessionUuid, modelKey });
			} catch (err) {
				// The customer already has their tokens. Failing the stream now would take
				// work away from someone who was paid for, so the charge is logged and the
				// generation stands. A lost charge is an accounting problem; a withdrawn
				// answer is a worse one.
				this.logger.error(
					`desktop usage metering failed for request ${requestId} (account ${accountId}): ${err instanceof Error ? err.message : String(err)}`,
				);
				this.record(accountId, requestId, "settlement.failed", { payload: { scope: "generation", reason: "record_usage_failed" }, sessionUuid, modelKey, status: "failed" });
			}
		};

		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				pending += decoder.decode(value ?? new Uint8Array(), { stream: true });
				const lines = pending.split("\n");
				// The last element is either an empty string or an incomplete line; either way
				// it stays for the next read.
				pending = lines.pop() ?? "";
				for (const line of lines) {
					await billIfDone(line);
					if (!res.destroyed) res.write(`${line}\n`);
				}
			}
			pending += decoder.decode();
			for (const line of pending.split("\n")) { await billIfDone(line); if (line && !res.destroyed) res.write(`${line}\n\n`); }
		} catch (err) {
			this.logger.warn(`desktop stream aborted for request ${requestId}: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			try {
				reader.releaseLock();
			} catch {
				// Already released by cancellation; nothing to do.
			}
			res.end();
		}
	}

	private async settleCompaction(raw: unknown, accountId: number, tier: string, modelKey: string, requestId: string, accessSource: "addon" | "tier" | null, scope: "desktop" | "playground", sessionUuid: string | null = null) {
		const usage = readUsageBlock(raw);
		if (!usage || usage.inputTokens + usage.outputTokens === 0) return;
		try {
			await this.billing.recordUsage({ accountId, tier, modelKey, usage, scope, accessSource, requestId: `${requestId}-compaction` });
			this.record(accountId, requestId, "settlement.succeeded", { payload: { scope: "compaction", input_tokens: usage.inputTokens, output_tokens: usage.outputTokens }, sessionUuid, modelKey });
		} catch (error) {
			this.logger.error(`Compaction settlement failed for ${requestId}: ${error instanceof Error ? error.message : String(error)}`);
			this.record(accountId, requestId, "settlement.failed", { payload: { scope: "compaction", reason: "record_usage_failed" }, sessionUuid, modelKey, status: "failed" });
		}
	}

	/**
	 * Save the fenced documents the model produced this reply, and tell the client about
	 * each one on the wire.
	 *
	 * Fail-open the same way billing is: a document the backend could not store must not
	 * fail the generation whose text already reached the reader. The answer stays in the
	 * chat either way; the notice says what did not make it to the account.
	 */
	private async emitReplyDocuments(res: ExpressResponse, accountId: number, requestId: string, sessionUuid: string | null, modelKey: string, answer: string): Promise<void> {
		if (!this.documents) return;
		const documents = extractPlaygroundDocuments(answer);
		if (!documents.length) return;
		let failures = 0;
		for (const document of documents) {
			try {
				const row = await this.documents.create(accountId, { name: document.name, content: document.content, runId: requestId });
				this.record(accountId, requestId, "document.saved", {
					payload: { name: document.name, bytes: document.bytes, scope: "reply-fence" },
					sessionUuid,
					modelKey,
				});
				if (!res.destroyed) {
					res.write(`data: ${JSON.stringify({ document: { id: String(row.id ?? ""), name: String(row.name ?? document.name), bytes: Number(row.content_bytes ?? document.bytes) } })}\n\n`);
				}
			} catch (error) {
				failures += 1;
				this.logger.warn(`playground document save failed for ${requestId}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (failures && !res.destroyed) {
			const notice = failures === documents.length
				? "The reply's document could not be saved to your account. The text remains in the conversation."
				: `Of the ${documents.length} documents in this reply, ${failures} could not be saved. The text remains in the conversation.`;
			try { res.write(`data: ${JSON.stringify({ notice })}\n\n`); } catch { /* The socket is gone; nothing else to record. */ }
		}
	}

	/** Thinking is reserved for the two top plans, mirroring the shared frontend table. */
	private tierAllowsThinking(tier: string): boolean {
		const t = String(tier || "").toLowerCase();
		return t === "max" || t === "ultimate";
	}
}

/**
 * Read a token count out of an upstream usage block.
 *
 * Both spellings are accepted because the AI service has used both, and a rename there must
 * not silently stop billing. Counts are floored at zero: a negative or fractional token
 * count is not something to bill in the customer's favour by accident.
 */
function readUsageBlock(raw: unknown): { inputTokens: number; outputTokens: number } | null {
	if (!raw || typeof raw !== "object") return null;
	const block = raw as Record<string, unknown>;
	const read = (value: unknown): number => {
		const n = Number(value);
		return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
	};
	return {
		inputTokens: read(block.prompt_tokens ?? block.input_tokens),
		outputTokens: read(block.completion_tokens ?? block.output_tokens),
	};
}
