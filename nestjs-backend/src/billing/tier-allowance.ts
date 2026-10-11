/**
 * What each plan includes, per month, denominated in RON.
 *
 * This is an *allowance of money*, not a count of prompts. One pot, spent across every
 * model at that model's own rate, so a plan's value depends on which models the customer
 * actually uses -- which is the point of quoting it in RON rather than in tokens.
 *
 * ## Why the rate depends on the plan
 *
 * The allowance is consumed at the *effective* rate: the subscriber's discounted rate for
 * anyone on a paid plan, and list price for free/anonymous. Worked example from the
 * pricing discussion, with a 30 RON/1M list input rate and a 20 RON/1M subscriber rate:
 * a 15 RON Basic allowance buys 15/20 = 750k input tokens at the discounted rate, and far
 * less in practice because output costs 5x input -- at 150 list / 100 discounted, the
 * same 15 RON is roughly 200k input plus 110k output. The RON figure on the plans page is
 * therefore an upper bound on input-only usage, and quoting it next to a token count
 * without that caveat would overstate what a customer gets.
 *
 * Free differs by whether there is an account at all: 3 RON anonymous, 5 RON signed up.
 * That is why `allowanceRon` takes `hasAccount` rather than keying off the tier alone.
 */

/** Anonymous visitors, no account. */
export const ANONYMOUS_ALLOWANCE_RON = 3;

/** Signed-in accounts on no plan. */
export const FREE_ALLOWANCE_RON = 5;

// prettier-ignore
export const TIER_ALLOWANCE_RON: Record<string, number> = {
	free:      5,
	basic:     15,
	plus:      35,
	pro:       60,
	max:       100,
	ultimate:  240,
};

/**
 * Monthly allowance for a tier.
 *
 * An unknown tier gets zero rather than the free rate. Defaulting an unrecognised plan
 * to a real allowance would let a tier that was meant to be restricted still spend money.
 */
export function allowanceRon(tier: string, hasAccount: boolean): number {
	const key = String(tier || "").trim().toLowerCase();
	if (!hasAccount) return ANONYMOUS_ALLOWANCE_RON;
	if (key === "" || key === "none") return FREE_ALLOWANCE_RON;
	const row = TIER_ALLOWANCE_RON[key];
	if (row === undefined) return 0;
	return row;
}

/**
 * True for plans that get a discount, and therefore consume the allowance at reduced rates.
 *
 * Membership is tested against the paid tiers explicitly rather than by excluding the free
 * ones. "Not free" is not the same as "paid": a typo, or a plan added without a price, would
 * otherwise qualify for the discount -- paying customers less for the same tokens.
 */
const PAID_TIERS = new Set(["basic", "plus", "pro", "max", "ultimate"]);

export function isPaidTier(tier: string): boolean {
	return PAID_TIERS.has(String(tier || "").trim().toLowerCase());
}

/**
 * Plans that may send messages from the Spectre Playground, and therefore may fund the
 * wallet that pays for them.
 *
 * Must agree with PLAYGROUND_MINIMUM_TIER in src/lib/entitlements.ts. The two are checked
 * against each other by `test:playground-billing`, which subscribes at each tier and
 * asserts the gate here and the route there agree -- a drift between them would mean
 * either charging for a product the route refuses, or refusing to charge for one it allows.
 *
 * Listed explicitly rather than as "paid and above", because the boundary is a product
 * decision: MAX and ULTIMATE get the Playground, and that happens to be the top two plans.
 * Deriving it from price would quietly change the moment a tier is repriced.
 */
export const SPECTRE_MINIMUM_TIER = "max";

const SPECTRE_TIERS = new Set([SPECTRE_MINIMUM_TIER, "ultimate"]);

/** True for plans entitled to the Spectre Playground and its funded wallet. */
export function canUseSpectre(tier: string): boolean {
	return SPECTRE_TIERS.has(String(tier || "").trim().toLowerCase());
}

/** The tiers a caller may fund from, for an error message that says what would work. */
export const SPECTRE_TIERS_ALLOWED: readonly string[] = [...SPECTRE_TIERS];

/** ISO-ish `YYYY-MM` for a date, in UTC so the reset instant does not drift by timezone. */
export function monthKey(date: Date = new Date()): string {
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * When the allowance resets: the first instant of the next UTC month.
 *
 * UTC rather than local because the counter is keyed on `monthKey`, which is UTC. Using a
 * local boundary would let two servers in different zones disagree about which month an
 * account is in, and one of them would hand out a second allowance.
 */
export function nextReset(date: Date = new Date()): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
