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
exports.PlaygroundAgentActionsController = void 0;
const common_1 = require("@nestjs/common");
const exact_playground_body_1 = require("../common/pipes/exact-playground-body");
const throttler_1 = require("@nestjs/throttler");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const playground_agent_actions_service_1 = require("./playground-agent-actions.service");
const account = (req) => { const id = Number(req.user?.id); if (!Number.isSafeInteger(id) || id <= 0)
    throw new common_1.UnauthorizedException(); return id; };
let PlaygroundAgentActionsController = class PlaygroundAgentActionsController {
    actions;
    constructor(actions) {
        this.actions = actions;
    }
    capabilities(req) { return this.actions.capabilities(account(req)); }
    prepare(req, res, body) {
        return this.cancellable(res, signal => this.actions.prepare(account(req), body, signal));
    }
    execute(req, res, id, body) {
        return this.cancellable(res, signal => this.actions.execute(account(req), id, body, signal));
    }
    async cancellable(res, operation) {
        const controller = new AbortController();
        const close = () => controller.abort();
        res.once("close", close);
        const timer = setTimeout(close, 90_000);
        try {
            return await operation(controller.signal);
        }
        finally {
            clearTimeout(timer);
            res.removeListener("close", close);
        }
    }
};
exports.PlaygroundAgentActionsController = PlaygroundAgentActionsController;
__decorate([
    (0, common_1.Get)("capabilities"),
    (0, common_1.Header)("Cache-Control", "no-store"),
    (0, throttler_1.Throttle)({ default: { limit: 30, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PlaygroundAgentActionsController.prototype, "capabilities", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.Header)("Cache-Control", "no-store"),
    (0, throttler_1.Throttle)({ default: { limit: 60, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, exact_playground_body_1.ExactPlaygroundBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], PlaygroundAgentActionsController.prototype, "prepare", null);
__decorate([
    (0, common_1.Post)(":id/execute"),
    (0, common_1.Header)("Cache-Control", "no-store"),
    (0, throttler_1.Throttle)({ default: { limit: 60, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __param(3, (0, exact_playground_body_1.ExactPlaygroundBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", void 0)
], PlaygroundAgentActionsController.prototype, "execute", null);
exports.PlaygroundAgentActionsController = PlaygroundAgentActionsController = __decorate([
    (0, common_1.Controller)("api/playground/agent/actions"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [playground_agent_actions_service_1.PlaygroundAgentActionsService])
], PlaygroundAgentActionsController);
