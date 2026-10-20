"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.desktopModelAccess = desktopModelAccess;
const billing_context_1 = require("../billing/billing-context");
/**
 * Whether one model may be used, and from which pot it is paid.
 *
 * The client and the stream gate must agree on this, so it is decided in one place and
 * called from both. The policy itself lives in `billing-context.ts`; this is the desktop
 * surface of it, and it exists because the desktop scope has one extra question the web
 * Playground never asks: can *this particular model* be afforded right now.
 *
 * That question has a real answer that is not "is the account rich enough". A Max customer
 * can run the 8B, but not out of their allowance, and an add-on holder cannot spend their
 * plan allowance on the Playground at all -- the subscription buys access, not usage. So
 * "the account has 5 RON of allowance" and "this message can be paid for" are different
 * questions, and a client that only asked the first one would let a customer start a
 * generation that is refused at the far end.
 */
function desktopModelAccess(params) {
    const hasAccess = params.accessSource !== null;
    // The same policy the charge is resolved with, so the catalogue cannot offer a model
    // under terms the charge would refuse.
    const context = (0, billing_context_1.resolveBillingContext)({
        scope: "desktop",
        tier: params.tier,
        accessSource: params.accessSource,
        modelKey: params.modelKey,
    });
    const usesAllowance = hasAccess && context.billFrom === "allowance_then_wallet";
    return {
        locked: !hasAccess,
        usesAllowance,
        requiresWallet: hasAccess && !usesAllowance,
        // Either pot can pay, and the wallet only applies when the model is not covered by
        // the allowance. An account with a funded wallet and no allowance for this model can
        // still run it; an account with an allowance for this model and no wallet can too.
        canGenerate: hasAccess && (params.walletCanGenerate || (usesAllowance && params.allowanceRemainingRon > 0)),
    };
}
