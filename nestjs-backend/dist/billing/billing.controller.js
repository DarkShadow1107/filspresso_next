"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingModule = exports.BillingController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const database_module_1 = require("../database/database.module");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const optional_jwt_auth_guard_1 = require("../common/guards/optional-jwt-auth.guard");
const kafelot_module_1 = require("../kafelot/kafelot.module");
const kafelot_service_1 = require("../kafelot/kafelot.service");
const billing_service_1 = require("./billing.service");
const model_pricing_1 = require("./model-pricing");
const tier_allowance_1 = require("./tier-allowance");
const fingerprint_1 = require("../common/utils/fingerprint");
/**
 * The caller's fingerprint, validated strictly.
 *
 * Absent entirely is a 401: there is nothing to meter against, and an unmetered caller is
 * an unlimited one. Present but malformed is a 400 from `parseFingerprint` -- never a
 * truncation, never a repair.
 */
function requireFingerprint(req) {
    const raw = req.headers?.[fingerprint_1.FINGERPRINT_HEADER];
    if (raw === undefined || raw === null || raw === "") {
        throw new common_1.UnauthorizedException("a session or a fingerprint is required");
    }
    return (0, fingerprint_1.parseFingerprint)(raw);
}
let BillingController = class BillingController {
    billing;
    kafelot;
    constructor(billing, kafelot) {
        this.billing = billing;
        this.kafelot = kafelot;
    }
    /**
     * The price list, for the model picker and the admin table.
     *
     * Public, because prices are not secret and the picker renders them before anyone has
     * signed in. A subscriber is sent exactly one price -- theirs. Sending both and letting
     * the client choose would hand the list price to precisely the accounts least entitled
     * to see it, and would make the displayed number a client-side decision about money.
     *
     * `?audience=api` returns the undiscounted list price to anyone, including subscribers.
     * That is the one deliberate exception, for the Spectre Playground, which is presented
     * as an API console: it shows what each model costs at list so a user can reason about
     * their own spend, and the *charge* against their funded balance still uses the
     * subscriber rate. Displaying a price is not the same as being billed it, and conflating
     * them would mean the console could only ever show one of the two numbers.
     */
    async getPricing(req) {
        const wantsApiPrices = String(req.query?.audience ?? "") === "api";
        const tier = await this.resolveTier(req);
        const subscriber = (0, tier_allowance_1.isPaidTier)(tier);
        const table = (0, model_pricing_1.pricingTable)();
        const showApi = wantsApiPrices || !subscriber;
        return {
            currency: table.currency,
            unit: table.unit,
            outputMultiplier: table.outputMultiplier,
            subscriber,
            /** True when these are list prices, i.e. not what this caller is charged. */
            listPrice: showApi,
            models: table.models.map((m) => showApi
                ? {
                    modelKey: m.modelKey,
                    label: m.label,
                    inputPer1M: m.apiInputPer1M,
                    outputPer1M: m.apiOutputPer1M,
                }
                : {
                    modelKey: m.modelKey,
                    label: m.label,
                    inputPer1M: m.subscriberInputPer1M,
                    outputPer1M: m.subscriberOutputPer1M,
                    subscriberDiscountPercent: m.subscriberDiscountPercent,
                }),
        };
    }
    /** The signed-in account's balance and recent spend. */
    async getBalance(req) {
        const accountId = this.requireAccountId(req);
        const balance = await this.billing.getBalance(accountId);
        const tier = await this.resolveTier(req);
        return {
            ...balance,
            autoRefillTargetRon: billing_service_1.AUTO_REFILL_TARGET_RON,
            maxBalanceRon: billing_service_1.MAX_FUNDED_BALANCE_RON,
            allowance: await this.billing.getAllowance(accountId, tier),
            recent: await this.billing.recentUsage(accountId, 20),
        };
    }
    /** Whether this account may start another generation. Checked before the model runs. */
    async canGenerate(req, modelKey) {
        const accountId = this.requireAccountId(req);
        const tier = await this.resolveTier(req);
        // One rule, in the service, covering both pots. This endpoint used to decide from the
        // wallet alone while *reporting* the hardcoded floor, so it contradicted itself --
        // and it refused accounts holding plenty of included allowance and no card balance.
        const state = await this.billing.canGenerate(accountId, tier);
        return {
            ...state,
            // Echoed so a caller can say which model it asked about. Not a gate: every model
            // on the plan draws on the same money.
            modelKey: String(modelKey ?? ""),
        };
    }
    /**
     * Record one generation's cost. Called by the Next layer after the model has run.
     *
     * Server-to-server, and deliberately not derived from anything the browser sends: the
     * caller states the token counts the AI service reported and the price is resolved here.
     * An endpoint that accepted a client-supplied `cost_ron` would be an endpoint that
     * accepts a client-supplied zero.
     *
     * Anonymous callers are metered too, by fingerprint, against their own 3 RON allowance.
     * The fingerprint is a client-supplied cookie and is treated as a courtesy budget, never
     * as identity: it grants no access and buys nothing. Absent both a session and a
     * fingerprint the request is refused rather than served free -- an unmetered caller
     * would be an unlimited one.
     *
     * `requestId` makes this idempotent, because it runs after work already paid for in GPU
     * time, which may legitimately be retried.
     */
    // Optional, not absent: the guard always allows and only populates req.user when a live
    // session is presented, from either a Bearer token or the session cookie Next forwards.
    // Dropping it did not merely skip authentication -- it silently emptied req.user, so
    // every cookie-authenticated report fell through to the anonymous branch and 401'd.
    async recordUsage(req, body) {
        const modelKey = String(body?.modelKey ?? "").trim();
        if (!modelKey)
            throw new common_1.BadRequestException("modelKey is required");
        const accountId = req.user?.id ? Number(req.user.id) : 0;
        // Resolved once, and only when it is actually needed. Absent is a 401 -- an
        // unmetered caller is an unlimited one. Present but malformed is a 400 from
        // parseFingerprint, never a silent repair.
        const fingerprint = accountId ? null : requireFingerprint(req);
        const inputTokens = Number(body?.inputTokens ?? 0);
        const outputTokens = Number(body?.outputTokens ?? 0);
        const requestId = body?.requestId ? String(body.requestId) : null;
        if (!accountId && fingerprint) {
            return this.billing.recordAnonymousUsage({
                fingerprint,
                modelKey,
                usage: { inputTokens, outputTokens },
                requestId,
            });
        }
        const subscriber = (0, tier_allowance_1.isPaidTier)(await this.resolveTier(req));
        const price = (0, model_pricing_1.resolveTokenPrice)(modelKey, subscriber);
        if (!price.known) {
            // Rejected, not charged zero. An unpriced model is a bug, and a zero-cost row
            // would bury it in an audit trail that otherwise looks complete.
            throw new common_1.BadRequestException(`unknown model: ${modelKey}`);
        }
        return this.billing.recordUsage({
            accountId,
            modelKey,
            subscriber,
            tier: await this.resolveTier(req),
            requestId,
            usage: { inputTokens, outputTokens },
        });
    }
    /** An anonymous visitor's remaining allowance, for the window that shows it. */
    async getAnonymousAllowance(req) {
        return this.billing.getAnonymousAllowance(requireFingerprint(req));
    }
    /**
     * This month's plan allowance: granted, spent, remaining, and when it resets.
     *
     * The number the Kafelot window shows. It replaced the prompt counter: this is money
     * that works across every model, whereas a prompt count only ever described one.
     */
    async getAllowance(req) {
        const accountId = this.requireAccountId(req);
        const tier = await this.resolveTier(req);
        return this.billing.getAllowance(accountId, tier);
    }
    /**
     * Add money to the funded wallet with the default card.
     *
     * No payment provider: the charge is recorded, not settled. The response says how much
     * was actually added, which can be less than asked for once the 1000 RON ceiling is in
     * view -- taking the full amount anyway would leave a balance the customer cannot
     * explain.
     */
    async fund(req, body) {
        const accountId = this.requireAccountId(req);
        const amount = Number(body?.amountRon);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new common_1.BadRequestException("amountRon must be a positive number");
        }
        const cardId = await this.billing.defaultCardId(accountId);
        if (!cardId) {
            // Falling back to "no card" would mean silently minting money with nothing to
            // charge, so an account with no default card cannot fund.
            throw new common_1.BadRequestException("add a default card before funding the playground");
        }
        const result = await this.billing.fund(accountId, amount, cardId, "user", body?.requestId ? String(body.requestId) : null);
        return {
            ...result,
            autoRefillTargetRon: billing_service_1.AUTO_REFILL_TARGET_RON,
            maxBalanceRon: billing_service_1.MAX_FUNDED_BALANCE_RON,
        };
    }
    /** The customer's own floor: 0 never goes negative, negative allows an overdraft. */
    async setMinBalance(req, body) {
        const accountId = this.requireAccountId(req);
        try {
            return await this.billing.setMinBalance(accountId, Number(body?.floorRon));
        }
        catch (err) {
            throw new common_1.BadRequestException(err instanceof Error ? err.message : "invalid floor");
        }
    }
    requireAccountId(req) {
        const id = Number(req.user?.id);
        if (!Number.isInteger(id) || id <= 0)
            throw new common_1.UnauthorizedException("authentication required");
        return id;
    }
    /**
     * Entitlement, read from `user_subscriptions` rather than the session claims.
     *
     * `req.user` carries id/email/username only, and the tier is a property of an active
     * subscription row -- so it is read where it lives. It is also the one input here that
     * must not be client-assertable, since it selects the price.
     */
    async resolveTier(req) {
        const id = Number(req.user?.id);
        if (!Number.isInteger(id) || id <= 0)
            return "free";
        return this.kafelot.resolveTier(id);
    }
};
exports.BillingController = BillingController;
__decorate([
    (0, common_1.UseGuards)(optional_jwt_auth_guard_1.OptionalJwtAuthGuard),
    (0, common_1.Get)("pricing"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "getPricing", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("balance"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "getBalance", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("can-generate"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("modelKey")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "canGenerate", null);
__decorate([
    (0, common_1.Post)("usage"),
    (0, common_1.UseGuards)(optional_jwt_auth_guard_1.OptionalJwtAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "recordUsage", null);
__decorate([
    (0, common_1.Get)("allowance/anonymous"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "getAnonymousAllowance", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("allowance"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "getAllowance", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("fund"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "fund", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Patch)("min-balance"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "setMinBalance", null);
exports.BillingController = BillingController = __decorate([
    (0, common_1.Controller)("api/billing"),
    __metadata("design:paramtypes", [billing_service_1.BillingService,
        kafelot_service_1.KafelotService])
], BillingController);
let BillingModule = class BillingModule {
};
exports.BillingModule = BillingModule;
exports.BillingModule = BillingModule = __decorate([
    (0, common_1.Module)({
        imports: [config_1.ConfigModule, database_module_1.DatabaseModule, kafelot_module_1.KafelotModule],
        controllers: [BillingController],
        providers: [billing_service_1.BillingService],
        exports: [billing_service_1.BillingService],
    })
], BillingModule);
