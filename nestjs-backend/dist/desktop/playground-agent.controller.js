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
exports.PlaygroundAgentController = void 0;
const common_1 = require("@nestjs/common");
const exact_playground_body_1 = require("../common/pipes/exact-playground-body");
const throttler_1 = require("@nestjs/throttler");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const billing_service_1 = require("../billing/billing.service");
const desktop_gateway_service_1 = require("./desktop-gateway.service");
function account(req) {
    const value = Number(req.user?.id);
    if (!Number.isInteger(value) || value <= 0)
        throw new common_1.UnauthorizedException();
    return value;
}
/** Shared cookie/bearer surface; every POST is independently gated, metered and non-retryable. */
let PlaygroundAgentController = class PlaygroundAgentController {
    billing;
    gateway;
    constructor(billing, gateway) {
        this.billing = billing;
        this.gateway = gateway;
    }
    capabilities(req) {
        account(req);
        return { version: 1, models: this.gateway.agentModels(), protocol: "native-v1", executesTools: false,
            interactionProtocols: ["question-v1"], conversationProtocol: "completed-turns-v1" };
    }
    async turn(req, res, body) {
        const id = account(req);
        res.setHeader("Cache-Control", "no-store");
        const controller = new AbortController();
        const close = () => controller.abort();
        res.once("close", close);
        try {
            let tier;
            try {
                tier = await this.billing.resolveTierFor(id);
            }
            catch {
                if (!res.destroyed && !res.headersSent)
                    res.status(503).json({ error: "BILLING_UNAVAILABLE", message: "Account billing could not be checked." });
                return;
            }
            if (controller.signal.aborted || res.headersSent)
                return;
            // JWT bearer is the native client; cookies use the existing web billing scope.
            const scope = typeof req.headers?.authorization === "string" && req.headers.authorization.startsWith("Bearer ") ? "desktop" : "playground";
            const result = await this.gateway.agentTurn(id, tier, body, scope, controller.signal);
            if (res.destroyed || res.headersSent)
                return;
            if (result.requestId)
                res.setHeader("x-filspresso-request-id", result.requestId);
            if (result.kind === "refused")
                res.status(result.status).json({ error: result.error, message: result.message });
            else
                res.status(200).json(result.payload);
        }
        finally {
            res.removeListener("close", close);
        }
    }
};
exports.PlaygroundAgentController = PlaygroundAgentController;
__decorate([
    (0, common_1.Get)("capabilities"),
    (0, common_1.Header)("Cache-Control", "no-store"),
    (0, throttler_1.Throttle)({ default: { limit: 30, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PlaygroundAgentController.prototype, "capabilities", null);
__decorate([
    (0, common_1.Post)("turn"),
    (0, throttler_1.Throttle)({ default: { limit: 30, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, exact_playground_body_1.ExactPlaygroundBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], PlaygroundAgentController.prototype, "turn", null);
exports.PlaygroundAgentController = PlaygroundAgentController = __decorate([
    (0, common_1.Controller)(["api/playground/agent", "api/desktop/agent"]),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [billing_service_1.BillingService, desktop_gateway_service_1.DesktopGatewayService])
], PlaygroundAgentController);
