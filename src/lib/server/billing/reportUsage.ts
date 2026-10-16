import { buildBackendUrl, copyRequestHeaders } from "@/lib/server/backend";

/**
 * Report one generation's token usage to the backend so it can be billed.
 *
 * The AI gateway already returns a `usage` block -- llama.cpp always did, and it used to be
 * parsed and thrown away. This is the step that makes the money real: without it the price
 * table, the allowance and the balance are all correct and none of them ever move.
 *
 * ## Why it is fire-and-forget
 *
 * This runs *after* the answer has been produced and is on its way to the customer. The
 * generation is already paid for in GPU time, so awaiting a billing write would add latency
 * to every reply to protect a number. A report that fails is dropped and logged; the
 * `requestId` makes a retry idempotent, so a later reconciliation can resend it safely.
 *
 * ## What it deliberately does not accept
 *
 * No `cost_ron`. The caller states token counts and the backend resolves the price from its
 * own table. A parameter for the amount charged would be a parameter an attacker sets to
 * zero.
 */

/**
 * Which surface the usage came from.
 *
 * Sent so the backend can pick the rate and the pot. It is a *statement* of where the
 * generation happened, not a request to be billed a particular way: `billing-context.ts`
 * reads the account's real entitlement and decides what follows.
 */
export type UsageScope = "kafelot" | "playground";

export type ReportedUsage = {
	inputTokens: number;
	outputTokens: number;
	costRon?: number;
	balanceRon?: number;
	allowanceRemainingRon?: number;
	priceMode?: string;
	billFrom?: string;
	reason?: string;
};

/** Coerce the gateway's usage block, refusing anything non-numeric. */
export function readUsageBlock(raw: unknown): { inputTokens: number; outputTokens: number } | null {
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

/**
 * Post a usage report. Resolves to the backend's answer, or null when it could not be
 * delivered. Never throws: the caller has already answered the customer.
 */
export async function reportUsage(
	request: Request,
	params: {
		modelKey: string;
		inputTokens: number;
		outputTokens: number;
		requestId?: string | null;
		/** The caller's fingerprint, for anonymous metering. */
		fingerprint?: string | null;
		/**
		 * Which surface this is. Defaults to kafelot, so a caller that has not been
		 * updated keeps its existing behaviour rather than silently changing price.
		 */
		scope?: UsageScope;
	},
): Promise<ReportedUsage | null> {
	const { modelKey, inputTokens, outputTokens, requestId, fingerprint } = params;
	const scope: UsageScope = params.scope ?? "kafelot";
	if (!modelKey) return null;
	// Nothing was spent: a lexical fallback or a cancelled request.
	if (!(inputTokens > 0) && !(outputTokens > 0)) return null;

	try {
		const headers = copyRequestHeaders(request);
		headers.set("content-type", "application/json");

		// The cookie identifies a subscriber; the fingerprint is what an anonymous caller
		// is metered against. The backend rejects a request carrying neither, because an
		// unmetered caller is an unlimited one.
		//
		// `origin`/`referer` come along with the cookie on purpose. The backend's origin
		// guard refuses a cookie-authenticated state change that arrives without one, and
		// for good reason: that is the shape of a CSRF attempt. Relaying them is what keeps
		// this report from being mistaken for one.
		if (fingerprint) headers.set("x-kafelot-fingerprint", fingerprint);

		const res = await fetch(buildBackendUrl("/api/billing/usage"), {
			method: "POST",
			headers,
			body: JSON.stringify({
				modelKey,
				inputTokens,
				outputTokens,
				scope,
				// The gateway's request id, so a retried report is charged once.
				requestId: requestId ?? undefined,
			}),
			cache: "no-store",
		});

		if (!res.ok) {
			// Logged rather than retried: 403/400 means this report will never be accepted,
			// and a rejected report must be visible, not silently dropped.
			console.warn(`[billing] usage report rejected: HTTP ${res.status}`);
			return null;
		}
		const data = (await res.json()) as ReportedUsage & { duplicate?: boolean };
		return data;
	} catch (err) {
		console.warn(`[billing] usage report failed: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}
