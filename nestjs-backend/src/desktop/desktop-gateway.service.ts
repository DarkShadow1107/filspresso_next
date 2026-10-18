import { Injectable, Logger } from "@nestjs/common";
// Aliased, because bare `Response` is the WHATWG fetch response and this file
// uses both: the fetch result it proxies from, and the express response it writes to.
import type { Response as ExpressResponse } from "express";
import * as crypto from "crypto";
import { BillingService } from "../billing/billing.service";
import { AddonsService } from "../billing/addons.service";
import { canUseSpectre } from "../billing/tier-allowance";
import { playgroundModelFile } from "./text-models";

/** Mirrors the web route's clamps, so the two surfaces cannot disagree on what is legal. */
const MAX_MESSAGE_LENGTH = 8000;
const MAX_SYSTEM_PROMPT_LENGTH = 2000;
const MAX_MAX_TOKENS = 2048;
const DEFAULT_MAX_TOKENS = 512;
const MAX_TEMPERATURE = 2;
const DEFAULT_TEMPERATURE = 0.7;

export type DesktopStreamResult =
	| { kind: "sent"; requestId: string }
	| { kind: "refused"; status: number; error: string; message: string };

/**
 * The metered inference path for the desktop client.
 *
 * This exists because there was nowhere else for a native client to send a request. The web
 * Playground is a Next route (`src/app/api/playground/chat/route.ts`) that calls the Python
 * AI service directly, and that service is published on port 5000 with no authentication at
 * all. A desktop client pointed at it would generate for free, unmetered, with no
 * entitlement check anywhere in the path.
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

	constructor(
		private readonly billing: BillingService,
		private readonly addons: AddonsService,
	) {}

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
	): Promise<{ refusal: DesktopStreamResult; accessSource: "addon" | "tier" | null } | { refusal: null; accessSource: "addon" | "tier" | null }> {
		const access = await this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier));
		const accessSource = access.source;
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

		try {
			const gate = await this.billing.canGenerate(accountId, tier);
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
	 * like a different request. The web route passes `requestId: null` and leans on the
	 * stream firing once; this path does not have to accept that.
	 */
	async streamChat(
		res: ExpressResponse,
		accountId: number,
		tier: string,
		body: Record<string, unknown>,
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

		// Resolved once, then passed down explicitly. Holding it on the service instance would
		// be a race: Nest services are singletons, so two streams in flight would overwrite each
		// other's access source and one of them would be billed from the wrong pot -- an add-on
		// customer charged at their tier's allowance rate, or the reverse.
		const gate = await this.refuse(accountId, tier);
		if (gate.refusal) return gate.refusal;
		const accessSource = gate.accessSource;

		// Thinking is restricted by plan, and it is decided from the server's own tier rather
		// than the request -- the same reasoning as the web route.
		const enableThinking = (body?.thinking === true || body?.thinking === "true") && this.tierAllowsThinking(tier);
		const requestId = `dsk-${crypto.randomBytes(12).toString("hex")}`;

		// An explicit AbortController rather than AbortSignal.timeout, to match how every
		// other service in this backend bounds its outbound calls (and to satisfy the
		// phase7-bounded-io invariant, which is right to insist that a timeout is visible in
		// the source rather than assumed).
		//
		// The bound is on the whole exchange, not on connect: a streaming generation legitimately
		// runs for minutes, and the thing that must never happen is a socket left open
		// indefinitely holding a connection from the pool.
		const upstreamController = new AbortController();
		const upstreamTimeout = setTimeout(
			() => upstreamController.abort(),
			Number(process.env.DESKTOP_STREAM_TIMEOUT_MS || "300000"),
		);

		let upstream: Response;
		try {
			upstream = await fetch(`${this.aiHost()}/api/chat/stream`, {
				method: "POST",
				headers: this.upstreamHeaders(),
				signal: upstreamController.signal,
				body: JSON.stringify({
					message,
					system_prompt: this.clampText(body?.system_prompt ?? body?.systemPrompt, MAX_SYSTEM_PROMPT_LENGTH),
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
			return {
				kind: "refused",
				status: 502,
				error: "UPSTREAM_UNAVAILABLE",
				message: "The model service could not be reached.",
			};
		}

		if (!upstream.ok || !upstream.body) {
			clearTimeout(upstreamTimeout);
			this.logger.warn(`desktop upstream returned HTTP ${upstream.status} for account ${accountId}`);
			return {
				kind: "refused",
				status: 502,
				error: "UPSTREAM_ERROR",
				message: "The model service could not complete that request.",
			};
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
			await this.pipeAndMeter(res, upstream.body, accountId, tier, modelKey, requestId, accessSource);
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
	): Promise<void> {
		const reader = upstreamBody.getReader();
		const decoder = new TextDecoder();
		let pending = "";
		let metered = false;

		const billIfDone = async (line: string) => {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data:")) return;
			const payload = trimmed.slice(5).trim();
			if (!payload || payload === "[DONE]") return;
			let event: { done?: boolean; usage?: unknown };
			try {
				event = JSON.parse(payload) as { done?: boolean; usage?: unknown };
			} catch {
				return;
			}
			if (!event.done || metered) return;
			const usage = readUsageBlock(event.usage);
			if (!usage) return;
			if (usage.inputTokens <= 0 && usage.outputTokens <= 0) return;
			metered = true;
			try {
				await this.billing.recordUsage({
					accountId,
					modelKey,
					usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
					scope: "desktop",
					// Supplied from the server's own resolution, never from the request. The pot
					// depends on which product granted access: an add-on holder pays from the
					// wallet alone, and a Max customer draws on their allowance.
					tier,
					accessSource,
					// The idempotency key. Same value as the header the client was given, so a
					// retried report for this stream cannot charge twice.
					requestId,
				});
			} catch (err) {
				// The customer already has their tokens. Failing the stream now would take
				// work away from someone who was paid for, so the charge is logged and the
				// generation stands. A lost charge is an accounting problem; a withdrawn
				// answer is a worse one.
				this.logger.error(
					`desktop usage metering failed for request ${requestId} (account ${accountId}): ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		};

		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) res.write(Buffer.from(value));
				pending += decoder.decode(value ?? new Uint8Array(), { stream: true });
				const lines = pending.split("\n");
				// The last element is either an empty string or an incomplete line; either way
				// it stays for the next read.
				pending = lines.pop() ?? "";
				for (const line of lines) await billIfDone(line);
			}
			pending += decoder.decode();
			for (const line of pending.split("\n")) await billIfDone(line);
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
