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
 *  - Playground, Max or Ultimate: list rate, allowance then wallet.
 *
 * ## Why every model draws on the allowance
 *
 * The retired 8B A1B exception is gone with the model. Under LFM 3 a Max or Ultimate
 * customer's allowance covers every model they can select, so there is no per-model
 * carve-out left to encode.
 */
export type BillFrom = "allowance_then_wallet" | "wallet_only";

export type BillingContext = {
	/** How the caller is charged. */
	priceMode: PriceMode;
	/** Where the money comes from. */
	billFrom: BillFrom;
	/** True when the charge consumed plan allowance, for the ledger and for the UI. */
	drewFromAllowance: boolean;
	/** A short human reason, surfaced in the 402 so the customer is told the right remedy. */
	reason: "included" | "wallet_only_no_allowance" | "no_allowance_remaining";
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
	scope: "kafelot" | "playground" | "desktop";
	tier: string;
	/** Which product granted Playground access. Null means the gate should have refused. */
	accessSource: "addon" | "tier" | null;
	modelKey: string;
}): BillingContext {
	const { scope, tier, accessSource } = params;

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

	// Everything below this point is the Spectre product, reached by two surfaces: the web
	// Playground and the desktop client. `desktop` is named separately so that adding a
	// fourth scope cannot silently inherit playground pricing -- a new scope falling through
	// to these branches is exactly the sort of quiet default that bills a customer for the
	// wrong thing.
	if (scope !== "playground" && scope !== "desktop") {
		throw new Error(`unhandled billing scope: ${String(scope)}`);
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