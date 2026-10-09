import { NextRequest } from "next/server";
import { resolveAiHost } from "@/lib/server/aiHost";
import { checkCanGenerate, readCallerTier } from "@/lib/server/promptLimits";
import { readUsageBlock, reportUsage } from "@/lib/server/billing/reportUsage";
import { getOrCreateFingerprint } from "@/lib/fingerprint";
import {
	MODEL_FILE_BY_KEY,
	MODEL_LABEL_BY_KEY,
	allowedTextModelsForTier,
	tierAllowsModel,
	tierCanUseThinkingModel,
	type TextModelKey,
	type UserSubscriptionTier,
} from "@/lib/modelAccess";
import { tierCanUsePlayground } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Playground chat: streams model output to the browser as Server-Sent Events.
 *
 * Differences from /api/python-chat, on purpose:
 *  - no coffee RAG pipeline and no lexical fallback; this is a raw conversation
 *    with the selected GGUF so temperature/system-prompt/thinking are meaningful
 *  - the whole model list is not offered to everyone: the Playground is a
 *    MAX/ULTIMATE feature and that is enforced here, server-side
 *  - prompts are metered through the same /api/kafelot quota as Kafelot
 */


const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant. Answer clearly and concisely.";
const MAX_SYSTEM_PROMPT_LENGTH = 2_000;
const MAX_MESSAGE_LENGTH = 8_000;

const DEFAULT_MAX_TOKENS = 512;
const MAX_MAX_TOKENS = 2_048;
const DEFAULT_TEMPERATURE = 0.7;
const MAX_TEMPERATURE = 2;

function jsonError(error: string, message: string, status: number) {
	return Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

function resolveRequestedModel(tier: UserSubscriptionTier, requested: unknown): TextModelKey {
	const allowed = allowedTextModelsForTier(tier);
	const candidate = typeof requested === "string" ? (requested.trim() as TextModelKey) : "";

	// Only honour the request when the tier is entitled to that exact model;
	// otherwise fall back to the best model the tier does have.
	if (candidate && Object.prototype.hasOwnProperty.call(MODEL_FILE_BY_KEY, candidate) && tierAllowsModel(tier, candidate)) {
		return candidate;
	}
	return allowed[allowed.length - 1] ?? "minilm_l6_v2_gguf";
}

export async function POST(request: NextRequest) {
	const tier = await readCallerTier(request);
	if (!tier) {
		return jsonError("UNAUTHORIZED", "Sign in to use the Playground.", 401);
	}

	if (!tierCanUsePlayground(tier)) {
		return jsonError(
			"PLAYGROUND_LOCKED",
			"The Playground is available on MAX and ULTIMATE plans.",
			403,
		);
	}

	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return jsonError("BAD_REQUEST", "Expected a JSON body.", 400);
	}

	const message = typeof body.message === "string" ? body.message.trim() : "";
	if (!message) {
		return jsonError("BAD_REQUEST", "Enter a prompt first.", 400);
	}
	if (message.length > MAX_MESSAGE_LENGTH) {
		return jsonError("BAD_REQUEST", `Prompt is too long (max ${MAX_MESSAGE_LENGTH} characters).`, 400);
	}

	const systemPromptRaw = typeof body.system_prompt === "string" ? body.system_prompt.trim() : "";
	const systemPrompt = (systemPromptRaw || DEFAULT_SYSTEM_PROMPT).slice(0, MAX_SYSTEM_PROMPT_LENGTH);
	const temperature = clampNumber(body.temperature, 0, MAX_TEMPERATURE, DEFAULT_TEMPERATURE);
	const maxTokens = Math.round(clampNumber(body.max_tokens, 1, MAX_MAX_TOKENS, DEFAULT_MAX_TOKENS));
	const thinkingRequested = body.thinking === true || body.thinking === "true";
	// Thinking is MAX/ULTIMATE-only by the shared table; never trust the client.
	const enableThinking = thinkingRequested && tierCanUseThinkingModel(tier);
	const modelKey = resolveRequestedModel(tier, body.model);

	// Money gate, before any GPU work: a caller with no allowance and no wallet must not
	// be able to make the model load for nothing.
	//
	// This replaced a check on PROMPT_LIMIT_REACHED, which the backend stopped returning
	// when the prompt quota was dropped -- so it had become a no-op that still read like a
	// control. The budget is money now, and this asks about money.
	const moneyGate = await checkCanGenerate(request);
	if (!moneyGate.allowed) {
		// Two different refusals, and they must not look alike. "You have no money" and
		// "we could not find out whether you have money" both stop the generation, but only
		// one of them is the customer's fault, and answering 402 to a billing outage would
		// tell paying customers to go and top up a wallet that is not the problem.
		if (moneyGate.reason !== "no_balance") {
			return jsonError(
				"BILLING_UNAVAILABLE",
				"We could not check your balance right now. Please try again in a moment.",
				503,
			);
		}
		return jsonError(
			"INSUFFICIENT_BALANCE",
			"Your monthly allowance and playground balance are both spent.",
			402,
		);
	}

	const aiHost = await resolveAiHost();

	let upstream: Response;
	try {
		upstream = await fetch(`${aiHost}/api/chat/stream`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
			cache: "no-store",
			body: JSON.stringify({
				message,
				system_prompt: systemPrompt,
				text_model: MODEL_FILE_BY_KEY[modelKey],
				temperature,
				max_tokens: maxTokens,
				enable_thinking: enableThinking,
			}),
		});
	} catch {
		return jsonError("AI_UNAVAILABLE", "The AI runtime is unavailable right now.", 503);
	}

	if (!upstream.ok || !upstream.body) {
		// 429 is the gateway's bounded-queue rejection and must reach the browser
		// intact: the client backs off on Retry-After, and collapsing it into a
		// generic 502 would turn a "try again in a second" signal into
		// "the AI runtime rejected the request".
		if (upstream.status === 429) {
			const retryAfter = upstream.headers.get("Retry-After") ?? "1";
			let detail = "That model is at capacity. Please retry shortly.";
			try {
				const parsed = (await upstream.json()) as { message?: string };
				if (parsed?.message) detail = parsed.message;
			} catch {
				// Non-JSON body: keep the default message.
			}
			return new Response(
				JSON.stringify({ error: "MODEL_BUSY", message: detail, retry_after: Number(retryAfter) || 1 }),
				{
					status: 429,
					headers: {
						"Content-Type": "application/json",
						"Retry-After": String(Number(retryAfter) || 1),
					},
				},
			);
		}
		return jsonError("AI_UNAVAILABLE", "The AI runtime rejected the request.", 502);
	}

	const modelLabel = MODEL_LABEL_BY_KEY[modelKey] ?? modelKey;

	// Re-emit the upstream SSE verbatim. The stream is created before the
	// response is returned, and an error mid-stream cannot change the status
	// code, so it is surfaced as an SSE `error` event by the Python side.
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const reader = upstream.body!.getReader();
			const decoder = new TextDecoder();
			// A generation has no single response object to hang a report off, so the
			// token counts are read out of the SSE itself. `pending` holds a partial line
			// between chunks, because a frame can straddle two TCP reads and a missed
			// done frame means a completed generation that nobody is charged for.
			let pending = "";

			const billIfDone = (line: string) => {
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
				if (!event.done) return;
				const usage = readUsageBlock(event.usage);
				if (!usage) return;
				void reportUsage(request, {
					modelKey,
					inputTokens: usage.inputTokens,
					outputTokens: usage.outputTokens,
					// One report per stream. The gateway request id is not threaded through
					// this route, so idempotency rests on the stream firing once; a duplicate
					// would need a second report to exist in the first place.
					requestId: null,
					fingerprint: getOrCreateFingerprint(),
				}).catch(() => null);
			};

			const pump = async () => {
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						if (value) {
							// Bytes go through untouched; only a copy is inspected.
							controller.enqueue(value);
							pending += decoder.decode(value, { stream: true });
							const lines = pending.split("\n");
							pending = lines.pop() ?? "";
							for (const line of lines) billIfDone(line);
						}
					}
					billIfDone(pending);
					controller.close();
				} catch (err) {
					try {
						controller.enqueue(
							new TextEncoder().encode(
								`data: ${JSON.stringify({ error: err instanceof Error ? err.message : "stream interrupted" })}\n\n`,
							),
						);
						controller.close();
					} catch {
						// The consumer already went away; nothing useful to do.
					}
				}
			};

			void pump();

			// If the browser aborts the fetch, stop pulling from Python so the
			// llama.cpp generation is cancelled instead of running to completion.
			request.signal.addEventListener("abort", () => {
				void reader.cancel().catch(() => undefined);
			});
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			// Tell nginx/Caddy not to buffer, otherwise tokens arrive in one batch.
			"X-Accel-Buffering": "no",
			"x-filspresso-model": modelKey,
			"x-filspresso-model-label": modelLabel,
			// Money, not prompts. The old x-filspresso-prompts-remaining / -limit pair was
			// carried by this response and read by nothing: the prompt quota they described
			// is gone, and a header nobody reads is a header nobody maintains.
			"x-filspresso-allowance-remaining-ron": moneyGate.allowanceRemainingRon != null
				? String(moneyGate.allowanceRemainingRon)
				: "",
			"x-filspresso-wallet-ron": moneyGate.balanceRon != null ? String(moneyGate.balanceRon) : "",
		},
	});
}
