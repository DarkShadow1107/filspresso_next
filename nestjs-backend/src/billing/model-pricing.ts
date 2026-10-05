/**
 * Token pricing, in RON per 1,000,000 tokens.
 *
 * ## Why this lives in the backend and not in `src/lib/`
 *
 * Money is decided in one runtime only. The frontend needs these numbers to *display*
 * them, so it fetches them from `/api/kafelot/pricing` rather than keeping a second
 * copy. That is a deliberate reversal of `MODEL_MONTHLY_LIMITS`, which is duplicated
 * into `src/lib/modelAccess.ts` and reconciled by `test/model-limits.test.ts` parsing
 * the TypeScript source and failing when the two drift. A duplicated price table would
 * be worse than a duplicated prompt limit: a drift there shows the wrong number to a
 * customer, and here it would *charge* the wrong number.
 *
 * ## Output
 *
 * Output is five times input. That is stated once, here, as a multiplier, rather than
 * as nine more numbers that could be typed wrong.
 *
 * ## Subscription discount
 *
 * `subscriberDiscountPercent` is the reduction applied to *both* input and output for an
 * account with an active subscription, so a subscriber pays 30% less per token across the
 * board and the output rate stays exactly 5x their input rate. Discounting only the input
 * rate would leave the headline "5x output" inconsistent between the two audiences.
 *
 * A non-subscriber pays `apiInputPer1M` / `apiOutputPer1M`. A subscriber pays
 * `subscriberInputPer1M` / `subscriberOutputPer1M`, and the API price is *not* shown to
 * them anywhere.
 */

/** Output tokens cost this multiple of input tokens. */
export const OUTPUT_PRICE_MULTIPLIER = 5;

export type TokenPrice = {
	/** RON per 1M input tokens, list price. */
	apiInputPer1M: number;
	/** Reduction for a subscribed account, applied to input and output alike. */
	subscriberDiscountPercent: number;
	/** Human label, for the admin table and the picker. */
	label: string;
};

export const MODEL_TOKEN_PRICING: Record<string, TokenPrice> = {
	// prettier-ignore
	lfm2_5_230m_q4_k_m:           { apiInputPer1M:  0.30, subscriberDiscountPercent: 30, label: "LFM 2.5 230M" },
	lfm2_5_350m_q8_0:             { apiInputPer1M:  0.50, subscriberDiscountPercent: 30, label: "LFM 2.5 350M" },
	lfm2_5_1_2b_instruct_q4_k_m:  { apiInputPer1M:  2.00, subscriberDiscountPercent: 60, label: "LFM 2.5 1.2B Instruct" },
	lfm2_5_1_2b_thinking_q4_k_m:  { apiInputPer1M:  3.00, subscriberDiscountPercent: 60, label: "LFM 2.5 1.2B Thinking" },
	lfm2_5_2_6b_q4_0:             { apiInputPer1M:  7.00, subscriberDiscountPercent: 40, label: "LFM 2.5 2.6B" },
	lfm2_5_8b_a1b_q4_k_m:         { apiInputPer1M: 20.00, subscriberDiscountPercent: 25, label: "LFM 2.5 8B A1B" },
	lfm2_5_vl_450m_q4_k_m:        { apiInputPer1M:  1.00, subscriberDiscountPercent: 25, label: "LFM 2.5 VL 450M" },
	lfm2_5_vl_3b_q4_k_m:          { apiInputPer1M: 10.00, subscriberDiscountPercent: 25, label: "LFM 2.5 VL 3B" },
	lfm2_5_audio_1_5b_q4_0:       { apiInputPer1M:  5.00, subscriberDiscountPercent: 25, label: "LFM 2.5 Audio 1.5B" },
};

export type ResolvedTokenPrice = {
	modelKey: string;
	label: string;
	/** True when the price came from the table rather than being refused. */
	known: boolean;
	subscriber: boolean;
	apiInputPer1M: number;
	apiOutputPer1M: number;
	subscriberInputPer1M: number;
	subscriberOutputPer1M: number;
	subscriberDiscountPercent: number;
};

/**
 * The price actually charged for one model.
 *
 * An unknown model resolves to zeroes rather than throwing: a typo in a model key must
 * not be able to fail a request that has already been served by llama.cpp. The caller
 * decides what to do about a zero charge, and `known` is how it finds out.
 */
export function resolveTokenPrice(modelKey: string, subscriber: boolean): ResolvedTokenPrice {
	const key = String(modelKey || "").trim();
	const entry = Object.prototype.hasOwnProperty.call(MODEL_TOKEN_PRICING, key)
		? MODEL_TOKEN_PRICING[key]
		: null;

	if (!entry) {
		return {
			modelKey: key,
			label: key || "unknown",
			known: false,
			subscriber,
			apiInputPer1M: 0,
			apiOutputPer1M: 0,
			subscriberInputPer1M: 0,
			subscriberOutputPer1M: 0,
			subscriberDiscountPercent: 0,
		};
	}

	const apiOutputPer1M = roundMoney(entry.apiInputPer1M * OUTPUT_PRICE_MULTIPLIER);
	const factor = 1 - entry.subscriberDiscountPercent / 100;

	return {
		modelKey: key,
		label: entry.label,
		known: true,
		subscriber,
		apiInputPer1M: roundMoney(entry.apiInputPer1M),
		apiOutputPer1M,
		subscriberInputPer1M: roundMoney(entry.apiInputPer1M * factor),
		subscriberOutputPer1M: roundMoney(apiOutputPer1M * factor),
		subscriberDiscountPercent: entry.subscriberDiscountPercent,
	};
}

/**
 * RON per 1M input/output, as charged to this audience.
 *
 * Non-subscribers get the list price. Subscribers are never shown the list price, so
 * this returns only the discounted pair for them.
 */
export function effectiveRates(price: ResolvedTokenPrice): { inputPer1M: number; outputPer1M: number } {
	return price.subscriber
		? { inputPer1M: price.subscriberInputPer1M, outputPer1M: price.subscriberOutputPer1M }
		: { inputPer1M: price.apiInputPer1M, outputPer1M: price.apiOutputPer1M };
}

/** Sub-second half-up rounding to 8 decimals: the smallest amount we ever store. */
export function roundMoney(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.round(value * 1e8) / 1e8;
}

export type TokenUsage = {
	inputTokens: number;
	outputTokens: number;
};

/**
 * Cost of one request in RON.
 *
 * Tokens are counted as non-negative integers; anything else is treated as zero so a
 * malformed usage block bills nothing rather than billing NaN.
 */
export function costRon(modelKey: string, usage: TokenUsage, subscriber: boolean): number {
	const price = resolveTokenPrice(modelKey, subscriber);
	if (!price.known) return 0;
	const rates = effectiveRates(price);
	const inputTokens = clampTokens(usage?.inputTokens);
	const outputTokens = clampTokens(usage?.outputTokens);
	const cost = (inputTokens / 1_000_000) * rates.inputPer1M + (outputTokens / 1_000_000) * rates.outputPer1M;
	return roundMoney(cost);
}

function clampTokens(value: unknown): number {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.floor(n);
}

/** The whole table, for the picker and the admin page. */
export function pricingTable(): {
	currency: "RON";
	unit: "per_1m_tokens";
	outputMultiplier: number;
	models: ResolvedTokenPrice[];
} {
	return {
		currency: "RON",
		unit: "per_1m_tokens",
		outputMultiplier: OUTPUT_PRICE_MULTIPLIER,
		models: Object.keys(MODEL_TOKEN_PRICING).map((key) => resolveTokenPrice(key, false)),
	};
}
