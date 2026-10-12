"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SimulatedChargeProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulatedChargeProvider = exports.ChargeProvider = void 0;
exports.autoRefillEnabled = autoRefillEnabled;
const common_1 = require("@nestjs/common");
/**
 * An abstract class rather than an interface, so it can serve as the injection token.
 *
 * With an interface, `{ provide: ChargeProvider, useClass: ... }` does not compile --
 * interfaces exist only in the type system and cannot be used as a value. An abstract class
 * is the conventional NestJS way to have one definition that is both the contract and the
 * token, which is what keeps the binding in one place.
 */
class ChargeProvider {
}
exports.ChargeProvider = ChargeProvider;
/**
 * The stand-in used while no provider is connected.
 *
 * Failure is simulated from the card id's last digit, which is deterministic and therefore
 * reproducible in a test, rather than from a random roll nobody can re-run. A card ending in
 * a specific digit lets a live check drive the declined path end to end.
 *
 * `SIMULATED_CHARGE_FAILURE_RATE` additionally rejects a share of charges at random, which is
 * how the retry and give-up paths in the refill and renewal jobs were exercised.
 */
let SimulatedChargeProvider = SimulatedChargeProvider_1 = class SimulatedChargeProvider {
    name = "simulated";
    logger = new common_1.Logger(SimulatedChargeProvider_1.name);
    attempts = 0;
    failureRate = readRate(process.env.SIMULATED_CHARGE_FAILURE_RATE);
    async charge(request) {
        this.attempts += 1;
        if (request.cardId == null) {
            return {
                ok: false,
                code: "no_card",
                message: "There is no default card to charge.",
                retryable: false,
            };
        }
        if (!Number.isFinite(request.amountRon) || request.amountRon <= 0) {
            return {
                ok: false,
                code: "invalid_amount",
                message: `Refusing to charge ${request.amountRon}.`,
                retryable: false,
            };
        }
        // Deterministic decline, for the failure paths. Documented in the README next to the
        // no-provider note so nobody has to read this file to exercise them.
        if (request.cardId % 10 === 7) {
            return {
                ok: false,
                code: "card_declined",
                message: "The card was declined.",
                retryable: true,
            };
        }
        if (this.failureRate > 0 && hash(`${request.reference}:${this.attempts}`) / 2 ** 32 < this.failureRate) {
            return {
                ok: false,
                code: "provider_unavailable",
                message: "The payment provider is unavailable.",
                retryable: true,
            };
        }
        this.logger.log(`[simulated] charged ${request.amountRon} ${request.currency} against card ${request.cardId} ` +
            `(${request.description}, ref ${request.reference}) -- no money moved`);
        return { ok: true, providerReference: `sim_${request.reference}` };
    }
    async refund(request) {
        this.logger.log(`[simulated] refunded ${request.amountRon} against ${request.providerReference} ` +
            `(${request.reason}) -- no money moved`);
        return { ok: true, providerReference: `sim_refund_${request.providerReference}` };
    }
};
exports.SimulatedChargeProvider = SimulatedChargeProvider;
exports.SimulatedChargeProvider = SimulatedChargeProvider = SimulatedChargeProvider_1 = __decorate([
    (0, common_1.Injectable)()
], SimulatedChargeProvider);
/** Stable 32-bit hash, so the random failure path is reproducible rather than flaky. */
function hash(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
function readRate(raw) {
    const value = Number(raw ?? "0");
    if (!Number.isFinite(value) || value <= 0)
        return 0;
    return Math.min(1, value);
}
/**
 * Is automatic refill allowed to run at all?
 *
 * A kill switch that defaults to on, because the feature is a promise the product already
 * makes to customers. Set AUTO_REFILL_ENABLED=false to stop it taking effect immediately
 * without a deploy.
 */
function autoRefillEnabled() {
    return String(process.env.AUTO_REFILL_ENABLED ?? "true").trim().toLowerCase() !== "false";
}
