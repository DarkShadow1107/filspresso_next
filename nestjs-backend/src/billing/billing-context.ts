import type { PriceMode } from "./model-pricing";

/**
 * Which pot a charge is drawn from, and what it is priced at.
 *
 * ## Why this is a policy and not a flag on the request
 *
 * The obvious implementation is to let the caller send `billFrom`. That lets a browser
 * decide whether its own usage may come out of the plan allowance, which is the same class
 * of mistake as accepting a client-supplied `cost_ron`. The caller states what happened;
 * this decides what it costs and where it lands.
 *
 * ## The rules, in one place
 *
 *  - Kafelot, paying tier: discounted rate, allowance then wallet. Unchanged.
 *  - Kafelot, free or anonymous: list rate, their allowance then nothing.
 *  - Playground, add-on only: list rate, **wallet only**. The 99.99 RON subscription buys
 *    access to the product and includes no usage at all, so there is no allowance to draw.
 *  - Playground, Max or Ultimate: list rate, allowance then wallet -- with one exception,
 *    below.
 *
 * ## The 8B exception
 *
 * Max may run the LFM 2.5 8B, but not out of its allowance. Its 100 RON would be consumed
 * by a handful of long answers, and a customer who spent it on the big model would find
 * the small models gone too. So Max pays for the 8B from the wallet. Ultimate is exempt:
 * its allowance is large enough that the distinction is not worth making.
 */
export type BillFrom = "allowance_then_wallet" | "wallet_only";

/**
 * Models that cannot draw on a plan allowance, by tier.
 *
 * A whitelist of tiers rather than of models, so adding a new model defaults to *allowed*:
 * the safe direction to fail is a customer being unable to use something, not a plan
 * quietly promising included usage that does not exist.
 */
const ALLOWANCE_EXCLUDED_MODELS: Record<string, ReadonlySet<string>> = {
	max: new Set(["lfm2_5_8b_a1b_q4_k_m"]),
};

export function allowanceCoversModel(tier: string, modelKey: string): boolean {
	const excluded = ALLOWANCE_EXCLUDED_MODELS[String(tier || "").trim().toLowerCase()];
	return !excluded?.has(String(modelKey || "").trim());
}

export type BillingContext = {
	/** How the caller is charged. */
	priceMode: PriceMode;
	/** Where the money comes from. */
	billFrom: BillFrom;
	/** True when the charge consumed plan allowance, for the ledger and for the UI. */
	drewFromAllowance: boolean;
	/** A short human reason, surfaced in the 402 so the customer is told the right remedy. */
	reason:
		| "included"
		| "wallet_only_no_allowance"
		| "model_excluded_from_allowance"
		| "no_allowance_remaining";
};

/**
 * Resolve the policy for one charge.
 *
 * `accessSource` is the discriminator, and it is *not* "does this account have a plan".
 *
 * That was the first implementation and it was wrong: it keyed on whether a plan allowance
 * existed, so a Pro customer who bought the Spectre subscription still had their 60 RON
 * plan allowance drawn down by Playground messages -- which is the opposite of what they
 * paid 99.99 RON for. What decides the pot is *which product granted access*: the add-on
 * includes no usage at all, whereas a bundled tier keeps its allowance.
 */
export function resolveBillingContext(params: {
	scope: "kafelot" | "playground";
	tier: string;
	/** Which product granted Playground access. Null means the gate should have refused. */
	accessSource: "addon" | "tier" | null;
	modelKey: string;
}): BillingContext {
	const { scope, tier, accessSource, modelKey } = params;

	if (scope === "kafelot") {
		// Untouched by any of this: a paid tier keeps its discount and its allowance in
		// Kafelot, which is the whole reason the price modes are separate.
		return {
			priceMode: isPaidTierName(tier) ? "subscriber" : "list",
			billFrom: "allowance_then_wallet",
			drewFromAllowance: false,
			reason: "included",
		};
	}

	if (accessSource === "addon") {
		// The subscription buys the product; usage is a separate meter. No allowance is
		// touched even when the account has one from its tier.
		return {
			priceMode: "playground",
			billFrom: "wallet_only",
			drewFromAllowance: false,
			reason: "wallet_only_no_allowance",
		};
	}

	if (!allowanceCoversModel(tier, modelKey)) {
		return {
			priceMode: "playground",
			billFrom: "wallet_only",
			drewFromAllowance: false,
			reason: "model_excluded_from_allowance",
		};
	}
	return {
		priceMode: "playground",
		billFrom: "allowance_then_wallet",
		drewFromAllowance: false,
		reason: "included",
	};
}

/** Local copy of the paid-tier test, to keep this module free of imports from tier-allowance. */
function isPaidTierName(tier: string): boolean {
	const value = String(tier || "").trim().toLowerCase();
	return ["basic", "plus", "pro", "max", "ultimate"].includes(value);
}