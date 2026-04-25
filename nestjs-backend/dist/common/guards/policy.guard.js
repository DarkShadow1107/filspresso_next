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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const policy_decorator_1 = require("../decorators/policy.decorator");
const opa_policy_service_1 = require("../../security/policy/opa-policy.service");
function getRequestIp(req) {
    const forwarded = String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim();
    return forwarded || String(req.headers["x-real-ip"] || "").trim() || req.ip || req.socket?.remoteAddress || null;
}
function normalizePath(req) {
    const raw = String(req.originalUrl || req.url || "");
    return raw.split("?")[0] || "/";
}
function buildIdentity(req) {
    if (req.serviceIdentity && typeof req.serviceIdentity === "object") {
        return {
            actor_type: req.serviceIdentity.actor_type || "service",
            service_name: req.serviceIdentity.service_name || null,
            role: req.serviceIdentity.role || "service",
        };
    }
    if (req.adminSession) {
        return {
            actor_type: "admin-user",
            account_id: req.adminSession.userId || null,
            username: req.adminSession.username || null,
            role: "admin",
        };
    }
    if (req.user) {
        return {
            actor_type: "user",
            account_id: req.user.id || null,
            username: req.user.username || null,
            role: req.user.role || "user",
        };
    }
    const serviceName = String(req.headers["x-service-name"] || "").trim();
    if (serviceName) {
        return {
            actor_type: "service",
            service_name: serviceName.slice(0, 128),
            role: "service",
        };
    }
    return {
        actor_type: "anonymous",
        role: "anonymous",
    };
}
let PolicyGuard = class PolicyGuard {
    reflector;
    opaPolicyService;
    constructor(reflector, opaPolicyService) {
        this.reflector = reflector;
        this.opaPolicyService = opaPolicyService;
    }
    async canActivate(context) {
        const classContext = this.reflector.get(policy_decorator_1.POLICY_METADATA_KEY, context.getClass());
        const handlerContext = this.reflector.get(policy_decorator_1.POLICY_METADATA_KEY, context.getHandler());
        const policyContext = handlerContext || classContext;
        if (!policyContext) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const decision = await this.opaPolicyService.evaluate({
            resource: policyContext.resource,
            action: policyContext.action,
            method: String(request.method || "GET").toUpperCase(),
            path: normalizePath(request),
            ipAddress: getRequestIp(request),
            requestId: request.requestId,
            identity: buildIdentity(request),
        });
        if (!decision.allow) {
            throw new common_1.ForbiddenException({
                error: "Policy denied request",
                reason: decision.reason,
                requestId: request.requestId,
            });
        }
        return true;
    }
};
exports.PolicyGuard = PolicyGuard;
exports.PolicyGuard = PolicyGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        opa_policy_service_1.OpaPolicyService])
], PolicyGuard);
