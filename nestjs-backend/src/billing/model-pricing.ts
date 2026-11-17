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
 * Output is stated explicitly per model rather than derived from a multiplier. The
 * LFM 3 family is priced at 4x input (15/60, 20/80, 25/100) while LFM 2.5 230M keeps
 * its historical 5x (0.30/1.50), so a single multiplier would be wrong for one of them.
 *
 * ## Long context
 *
 * Every LFM 3 model is served with a 256K window. A request whose input is within the
 * first 128K tokens is billed at the listed API rate; a request above 128K is billed at
 * **double** that rate for the whole request. The Free-only 230M has a 128K window and is
 * never surcharged, so its own requests cannot reach the threshold.
 *
 * ## Subscription discount
 *
 * `subscriberDiscountPercent` is the reduction applied to *both* input and output for an
 * account with an active subscription. The LFM 3 models are `0` because both Kafelot and
 * the Playground charge their published API rate. The Free-only 230M keeps its existing
 * discount; it is not reachable from a paid plan.
 */

/** Historical output/input ratio for the Free-only LFM 2.5 230M entry. */
export const LEGACY_230M_OUTPUT_PRICE_MULTIPLIER = 5;

/** Input above this many tokens is billed at the long-context rate. */
export const LONG_CONTEXT_THRESHOLD_TOKENS = 131_072;

/** Multiplier applied to every rate when a request exceeds the threshold. */
export const LONG_CONTEXT_PRICE_MULTIPLIER = 2;

export type TokenPrice = {
	/** RON per 1M input tokens, list price. */
	apiInputPer1M: number;
	/** RON per 1M output tokens, list price. */
	apiOutputPer1M: number;
	/** Reduction for a subscribed account, applied to input and output alike. */
	subscriberDiscountPercent: number;
	/** Whether input above the long-context threshold is billed at double the rate. */
	longContextPricing: boolean;
	/** Human label, for the admin table and the picker. */
	label: string;
};

export const MODEL_TOKEN_PRICING: Record<string, TokenPrice> = {
	// prettier-ignore
	lfm2_5_230m_q4_k_m:   { apiInputPer1M:  0.30, apiOutputPer1M:  1.50, subscriberDiscountPercent: 30, longContextPricing: false, label: "LFM 2.5 230M" },
	lfm3_1_7b_q4_k_m:     { apiInputPer1M: 15.00, apiOutputPer1M: 60.00, subscriberDiscountPercent:  0, longContextPricing: true, label: "LFM 3 1.7B" },
	lfm3_vl_2b_q4_k_m:    { apiInputPer1M: 20.00, apiOutputPer1M: 80.00, subscriberDiscountPercent:  0, longContextPricing: true, label: "LFM 3 VL 2B" },
	lfm3_audio_2b_q4_k_m: { apiInputPer1M: 20.00, apiOutputPer1M: 80.00, subscriberDiscountPercent:  0, longContextPricing: true, label: "LFM 3 Audio 2B" },
	lfm3_omni_2b_q4_k_m:  { apiInputPer1M: 25.00, apiOutputPer1M: 100.00, subscriberDiscountPercent: 0, longContextPricing: true, label: "LFM 3 Omni 2B" },
};

export type ResolvedTokenPrice = {
	modelKey: string;
	label: string;
	/** True when the price came from the table rather than being refused. */
	known: boolean;
	subscriber: boolean;
	/** Which of the three rates below is the one actually charged. */
	priceMode: PriceMode;
	apiInputPer1M: number;
	apiOutputPer1M: number;
	subscriberInputPer1M: number;
	subscriberOutputPer1M: number;
	subscriberDiscountPercent: number;
	/** Whether this model is surcharged above the long-context threshold. */
	longContextPricing: boolean;
	/** The rate this call is actually charged, resolved once so nobody recomputes it. */
	chargedInputPer1M: number;
	chargedOutputPer1M: number;
};

/**
 * Which price list a charge is drawn from.
 *
 * Three modes rather than a boolean, because "is this a subscriber" stopped being enough
 * the moment the Spectre Playground arrived:
 *
 *  - `list`       an anonymous or free account: the published API rate.
 *  - `subscriber` a paying tier *in Kafelot*: the discounted rate (zero discount for LFM 3).
 *  - `playground` any tier or add-on *in the Spectre Playground*: the published API rate,
 *                 with no discount.
 *
 * The Playground is list-priced on purpose. A customer buying the 99.99 RON Spectre
 * subscription is buying access to the product, not a discount on tokens -- usage is a
 * separate meter. Keeping `subscriber` for Kafelot is what stops that change from silently
 * repricing existing customers' coffee-chat usage.
 */
export type PriceMode = "list" | "subscriber" | "playground";

export const PRICE_MODES: readonly PriceMode[] = ["list", "subscriber", "playground"];

/**
 * The price actually charged for one model.
 *
 * An unknown model resolves to zeroes rather than throwing: a typo in a model key must
 * not be able to fail a request that has already been served by llama.cpp. The caller
 * decides what to do about a zero charge, and `known` is how it finds out.
 */
export function resolveTokenPrice(modelKey: string, priceMode: PriceMode | boolean): ResolvedTokenPrice {
	const key = String(modelKey || "").trim();
	// A bare boolean still works, so every existing call site keeps its meaning. Converting
	// them one at a time is how this becomes reviewable rather than one large diff.
	const mode: PriceMode =
		typeof priceMode === "boolean" ? (priceMode ? "subscriber" : "list") : priceMode;
	const subscriber = mode === "subscriber";
	const entry = Object.prototype.hasOwnProperty.call(MODEL_TOKEN_PRICING, key)
		? MODEL_TOKEN_PRICING[key]
		: null;

	if (!entry) {
		return {
			modelKey: key,
			label: key || "unknown",
			known: false,
			subscriber,
			priceMode: mode,
			apiInputPer1M: 0,
			apiOutputPer1M: 0,
			subscriberInputPer1M: 0,
			subscriberOutputPer1M: 0,
			subscriberDiscountPercent: 0,
			longContextPricing: false,
			chargedInputPer1M: 0,
			chargedOutputPer1M: 0,
		};
	}

	const factor = 1 - entry.subscriberDiscountPercent / 100;
	const apiInput = roundMoney(entry.apiInputPer1M);
	const apiOutputPer1M = roundMoney(entry.apiOutputPer1M);
	const subscriberInputPer1M = roundMoney(entry.apiInputPer1M * factor);
	const subscriberOutputPer1M = roundMoney(apiOutputPer1M * factor);

	return {
		modelKey: key,
		label: entry.label,
		known: true,
		subscriber,
		priceMode: mode,
		apiInputPer1M: apiInput,
		apiOutputPer1M,
		subscriberInputPer1M,
		subscriberOutputPer1M,
		subscriberDiscountPercent: entry.subscriberDiscountPercent,
		longContextPricing: entry.longContextPricing,
		// The Playground deliberately takes the list rate even for a paying tier, so this
		// cannot be derived from `subscriber` alone any more.
		chargedInputPer1M: subscriber ? subscriberInputPer1M : apiInput,
		chargedOutputPer1M: subscriber ? subscriberOutputPer1M : apiOutputPer1M,
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

/** True when a request with this many input tokens is billed at the long-context rate. */
export function appliesLongContextPricing(inputTokens: unknown): boolean {
	return clampTokens(inputTokens) > LONG_CONTEXT_THRESHOLD_TOKENS;
}

/**
 * Rates as stored against a charge, including the long-context multiplier.
 *
 * Kept separate from `effectiveRates` so the audit row records what was actually
 * charged rather than the base list price.
 */
export function billedRates(
	price: ResolvedTokenPrice,
	inputTokens: unknown,
): { inputPer1M: number; outputPer1M: number; longContext: boolean } {
	const rates = effectiveRates(price);
	const longContext = price.longContextPricing && appliesLongContextPricing(inputTokens);
	const multiplier = longContext ? LONG_CONTEXT_PRICE_MULTIPLIER : 1;
	return {
		inputPer1M: roundMoney(rates.inputPer1M * multiplier),
		outputPer1M: roundMoney(rates.outputPer1M * multiplier),
		longContext,
	};
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
 * Cost of one request in RON, at whichever rate list `priceMode` selects.
 *
 * Takes the mode rather than a bare boolean because this function used to recompute the price
 * from `subscriber` alone, which silently ignored the Playground mode: a Max account was
 * charged the subscriber rate there while the resolved price object beside it said list.
 *
 * A request whose input exceeds 128K tokens is charged at double the resolved rate when
 * the model opts into long-context pricing, as stated on the plans page. The whole request
 * is doubled, not just the excess, because that is the published rule and it is simpler to
 * audit.
 *
 * Tokens are counted as non-negative integers; anything else is treated as zero so a
 * malformed usage block bills nothing rather than billing NaN.
 */
export function costRon(modelKey: string, usage: TokenUsage, priceMode: PriceMode | boolean): number {
	const price = resolveTokenPrice(modelKey, priceMode);
	if (!price.known) return 0;
	const inputTokens = clampTokens(usage?.inputTokens);
	const outputTokens = clampTokens(usage?.outputTokens);
	const rates = billedRates(price, inputTokens);
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
	/** @deprecated No single multiplier applies; use each model's explicit output rate. */
	outputMultiplier: null;
	longContextThresholdTokens: number;
	longContextMultiplier: number;
	models: ResolvedTokenPrice[];
} {
	return {
		currency: "RON",
		unit: "per_1m_tokens",
		outputMultiplier: null,
		longContextThresholdTokens: LONG_CONTEXT_THRESHOLD_TOKENS,
		longContextMultiplier: LONG_CONTEXT_PRICE_MULTIPLIER,
		models: Object.keys(MODEL_TOKEN_PRICING).map((key) => resolveTokenPrice(key, false)),
	};
}
