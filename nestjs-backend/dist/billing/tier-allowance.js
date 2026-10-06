"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIER_ALLOWANCE_RON = exports.FREE_ALLOWANCE_RON = exports.ANONYMOUS_ALLOWANCE_RON = void 0;
exports.allowanceRon = allowanceRon;
exports.isPaidTier = isPaidTier;
exports.monthKey = monthKey;
exports.nextReset = nextReset;
/** Anonymous visitors, no account. */
exports.ANONYMOUS_ALLOWANCE_RON = 3;
/** Signed-in accounts on no plan. */
exports.FREE_ALLOWANCE_RON = 5;
// prettier-ignore
exports.TIER_ALLOWANCE_RON = {
    free: 5,
    basic: 15,
    plus: 35,
    pro: 60,
    max: 100,
    ultimate: 240,
};
/**
 * Monthly allowance for a tier.
 *
 * An unknown tier gets zero rather than the free rate. Defaulting an unrecognised plan
 * to a real allowance would let a tier that was meant to be restricted still spend money.
 */
function allowanceRon(tier, hasAccount) {
    const key = String(tier || "").trim().toLowerCase();
    if (!hasAccount)
        return exports.ANONYMOUS_ALLOWANCE_RON;
    if (key === "" || key === "none")
        return exports.FREE_ALLOWANCE_RON;
    const row = exports.TIER_ALLOWANCE_RON[key];
    if (row === undefined)
        return 0;
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
function isPaidTier(tier) {
    return PAID_TIERS.has(String(tier || "").trim().toLowerCase());
}
/** ISO-ish `YYYY-MM` for a date, in UTC so the reset instant does not drift by timezone. */
function monthKey(date = new Date()) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
/**
 * When the allowance resets: the first instant of the next UTC month.
 *
 * UTC rather than local because the counter is keyed on `monthKey`, which is UTC. Using a
 * local boundary would let two servers in different zones disagree about which month an
 * account is in, and one of them would hand out a second allowance.
 */
function nextReset(date = new Date()) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
