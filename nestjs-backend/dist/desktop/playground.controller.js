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
exports.PlaygroundController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const billing_service_1 = require("../billing/billing.service");
const addons_service_1 = require("../billing/addons.service");
const tier_allowance_1 = require("../billing/tier-allowance");
const desktop_policy_1 = require("./desktop-policy");
const text_models_1 = require("./text-models");
const desktop_gateway_service_1 = require("./desktop-gateway.service");
const httpClient_1 = require("../common/utils/httpClient");
/** Cookie and bearer clients share the same authoritative Playground gate/meter. */
let PlaygroundController = class PlaygroundController {
    billing;
    addons;
    gateway;
    constructor(billing, addons, gateway) {
        this.billing = billing;
        this.addons = addons;
        this.gateway = gateway;
    }
    async chat(req, res, body) {
        const accountId = Number(req.user?.id);
        const tier = await this.billing.resolveTierFor(accountId);
        const result = await this.gateway.streamChat(res, accountId, tier, body ?? {}, "playground");
        if (result.kind === "refused")
            res.status(result.status).json({ error: result.error, message: result.message });
    }
    async load(req, body) {
        const modelKey = typeof body?.model === "string" ? body.model : "";
        const file = (0, text_models_1.playgroundModelFile)(modelKey);
        if (!file)
            throw new common_1.BadRequestException({ error: "UNKNOWN_MODEL", message: "Choose an available model." });
        try {
            const accountId = Number(req.user?.id);
            const tier = await this.billing.resolveTierFor(accountId);
            const access = await this.addons.resolveSpectreAccess(accountId, tier, (0, tier_allowance_1.canUseSpectre)(tier));
            if (!access.hasAccess)
                throw new common_1.ForbiddenException({ error: "PLAYGROUND_LOCKED" });
            const [wallet, allowance] = await Promise.all([this.billing.getBalance(accountId), this.billing.getAllowance(accountId, tier)]);
            if (!(0, desktop_policy_1.desktopModelAccess)({ modelKey, tier, accessSource: access.source, walletCanGenerate: wallet.canGenerate, allowanceRemainingRon: allowance.remainingRon }).canGenerate)
                throw new common_1.HttpException({ error: "INSUFFICIENT_BALANCE", message: "This model needs available allowance or wallet credit." }, 402);
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.ServiceUnavailableException({ error: "BILLING_UNAVAILABLE" });
        }
        try {
            const host = (process.env.PYTHON_AI_HOST || "http://ai:5000").replace(/\/+$/, "");
            const key = process.env.AI_SERVICE_KEY?.trim();
            const response = await (0, httpClient_1.fetchBounded)(`${host}/api/warmup`, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "x-ai-service-key": key } : {}) },
                body: JSON.stringify({ model: file, vision: modelKey.includes("_vl_") }), timeoutMs: 10_000, maxBytes: 64_000 });
            const data = await response.json();
            if (!response.ok)
                throw new common_1.ServiceUnavailableException({ error: "AI_UNAVAILABLE" });
            return data;
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.ServiceUnavailableException({ error: "AI_UNAVAILABLE" });
        }
    }
};
exports.PlaygroundController = PlaygroundController;
__decorate([
    (0, common_1.Post)("chat/stream"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], PlaygroundController.prototype, "chat", null);
__decorate([
    (0, common_1.Post)("models/load"),
    (0, throttler_1.Throttle)({ default: { limit: 12, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PlaygroundController.prototype, "load", null);
exports.PlaygroundController = PlaygroundController = __decorate([
    (0, common_1.Controller)("api/playground"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [billing_service_1.BillingService, addons_service_1.AddonsService, desktop_gateway_service_1.DesktopGatewayService])
], PlaygroundController);
