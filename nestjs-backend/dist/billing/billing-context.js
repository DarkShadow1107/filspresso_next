"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allowanceCoversModel = allowanceCoversModel;
exports.resolveBillingContext = resolveBillingContext;
/**
 * Models that cannot draw on a plan allowance, by tier.
 *
 * A whitelist of tiers rather than of models, so adding a new model defaults to *allowed*:
 * the safe direction to fail is a customer being unable to use something, not a plan
 * quietly promising included usage that does not exist.
 */
const ALLOWANCE_EXCLUDED_MODELS = {
    max: new Set(["lfm2_5_8b_a1b_q4_k_m"]),
};
function allowanceCoversModel(tier, modelKey) {
    const excluded = ALLOWANCE_EXCLUDED_MODELS[String(tier || "").trim().toLowerCase()];
    return !excluded?.has(String(modelKey || "").trim());
}
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
function resolveBillingContext(params) {
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
function isPaidTierName(tier) {
    const value = String(tier || "").trim().toLowerCase();
    return ["basic", "plus", "pro", "max", "ultimate"].includes(value);
}
