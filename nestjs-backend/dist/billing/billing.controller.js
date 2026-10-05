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
/** Tiers that get the subscriber rate. `none` and `free` pay list price. */
const FREE_TIERS = new Set(["", "none", "free"]);
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
     */
    async getPricing(req) {
        const tier = await this.resolveTier(req);
        const subscriber = !FREE_TIERS.has(tier);
        const table = (0, model_pricing_1.pricingTable)();
        return {
            currency: table.currency,
            unit: table.unit,
            outputMultiplier: table.outputMultiplier,
            subscriber,
            models: table.models.map((m) => subscriber
                ? {
                    modelKey: m.modelKey,
                    label: m.label,
                    inputPer1M: m.subscriberInputPer1M,
                    outputPer1M: m.subscriberOutputPer1M,
                    subscriberDiscountPercent: m.subscriberDiscountPercent,
                }
                : {
                    modelKey: m.modelKey,
                    label: m.label,
                    inputPer1M: m.apiInputPer1M,
                    outputPer1M: m.apiOutputPer1M,
                }),
        };
    }
    /** The signed-in account's balance and recent spend. */
    async getBalance(req) {
        const accountId = this.requireAccountId(req);
        const balance = await this.billing.getBalance(accountId);
        return { ...balance, recent: await this.billing.recentUsage(accountId, 20) };
    }
    /** Whether this account may start another generation. Checked before the model runs. */
    async canGenerate(req, modelKey) {
        const accountId = this.requireAccountId(req);
        const balance = await this.billing.getBalance(accountId);
        return {
            canGenerate: balance.canGenerate,
            balanceRon: balance.balanceRon,
            minBalanceRon: billing_service_1.MIN_BALANCE_RON,
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
     * `requestId` makes this idempotent, because it runs after work already paid for in GPU
     * time, which may legitimately be retried.
     */
    async recordUsage(req, body) {
        const accountId = this.requireAccountId(req);
        const modelKey = String(body?.modelKey ?? "").trim();
        if (!modelKey)
            throw new common_1.BadRequestException("modelKey is required");
        const subscriber = !FREE_TIERS.has(await this.resolveTier(req));
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
            requestId: body?.requestId ? String(body.requestId) : null,
            usage: {
                inputTokens: Number(body?.inputTokens ?? 0),
                outputTokens: Number(body?.outputTokens ?? 0),
            },
        });
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
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("usage"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "recordUsage", null);
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
