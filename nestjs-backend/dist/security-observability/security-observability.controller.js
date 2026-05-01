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
exports.SecurityObservabilityController = void 0;
const common_1 = require("@nestjs/common");
const policy_decorator_1 = require("../common/decorators/policy.decorator");
const policy_guard_1 = require("../common/guards/policy.guard");
const security_observability_service_1 = require("./security-observability.service");
const service_events_auth_guard_1 = require("./service-events-auth.guard");
function parseBoundedInt(raw, fallback, min, max) {
    const parsed = Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(Math.max(parsed, min), max);
}
let SecurityObservabilityController = class SecurityObservabilityController {
    securityObservabilityService;
    constructor(securityObservabilityService) {
        this.securityObservabilityService = securityObservabilityService;
    }
    async getServiceEvents(req, limitQuery, windowHoursQuery) {
        const limit = parseBoundedInt(limitQuery, 120, 1, 1000);
        const windowHours = parseBoundedInt(windowHoursQuery, 24, 1, 24 * 365);
        return this.securityObservabilityService.getServiceIncidentHistory(limit, windowHours, req.requestId);
    }
    async getSecurityObservability(req, windowMinutesQuery, mpcStaleMinutesQuery) {
        const windowMinutes = parseBoundedInt(windowMinutesQuery, 60, 5, 24 * 60);
        const mpcStaleMinutes = parseBoundedInt(mpcStaleMinutesQuery, 30, 5, 24 * 60);
        const snapshot = await this.securityObservabilityService.collectSecurityObservabilitySnapshot({
            windowMinutes,
            mpcStaleMinutes,
        });
        return {
            ...snapshot,
            requestId: req.requestId,
        };
    }
    async getSecurityAlerts(req) {
        return this.securityObservabilityService.getSecurityAlerts(req.requestId);
    }
    async dispatchSecurityAlerts(req, body) {
        return this.securityObservabilityService.dispatchSecurityAlert(body, req.requestId);
    }
    async verifyServiceLedger(req, chainScopeQuery, maxRowsQuery, res) {
        const chainScope = String(chainScopeQuery || "service-health").trim() || "service-health";
        const maxRows = parseBoundedInt(maxRowsQuery, 10000, 1, 100000);
        const result = await this.securityObservabilityService.verifySecurityLedger(chainScope, maxRows, req.requestId);
        res.status(result.statusCode).json(result.payload);
    }
    async ingestServiceEventsBulk(req, body) {
        const events = Array.isArray(body.events)
            ? body.events.filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))
            : [];
        return this.securityObservabilityService.ingestServiceEventsBulk(events, req.requestId);
    }
};
exports.SecurityObservabilityController = SecurityObservabilityController;
__decorate([
    (0, common_1.Get)("services/events"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("limit")),
    __param(2, (0, common_1.Query)("windowHours")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], SecurityObservabilityController.prototype, "getServiceEvents", null);
__decorate([
    (0, common_1.Get)("security/observability"),
    (0, common_1.UseGuards)(service_events_auth_guard_1.ServiceEventsAuthGuard, policy_guard_1.PolicyGuard),
    (0, policy_decorator_1.Policy)({ resource: "service-events", action: "observe" }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("windowMinutes")),
    __param(2, (0, common_1.Query)("mpcStaleMinutes")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], SecurityObservabilityController.prototype, "getSecurityObservability", null);
__decorate([
    (0, common_1.Get)("security/alerts"),
    (0, common_1.UseGuards)(service_events_auth_guard_1.ServiceEventsAuthGuard, policy_guard_1.PolicyGuard),
    (0, policy_decorator_1.Policy)({ resource: "service-events", action: "alerts" }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SecurityObservabilityController.prototype, "getSecurityAlerts", null);
__decorate([
    (0, common_1.Post)("security/alerts/dispatch"),
    (0, common_1.UseGuards)(service_events_auth_guard_1.ServiceEventsAuthGuard, policy_guard_1.PolicyGuard),
    (0, policy_decorator_1.Policy)({ resource: "service-events", action: "alerts" }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SecurityObservabilityController.prototype, "dispatchSecurityAlerts", null);
__decorate([
    (0, common_1.Get)("services/ledger/verify"),
    (0, common_1.UseGuards)(service_events_auth_guard_1.ServiceEventsAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("chainScope")),
    __param(2, (0, common_1.Query)("maxRows")),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], SecurityObservabilityController.prototype, "verifyServiceLedger", null);
__decorate([
    (0, common_1.Post)("services/events/bulk"),
    (0, common_1.UseGuards)(service_events_auth_guard_1.ServiceEventsAuthGuard, policy_guard_1.PolicyGuard),
    (0, policy_decorator_1.Policy)({ resource: "service-events", action: "ingest" }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SecurityObservabilityController.prototype, "ingestServiceEventsBulk", null);
exports.SecurityObservabilityController = SecurityObservabilityController = __decorate([
    (0, common_1.Controller)("health"),
    __metadata("design:paramtypes", [security_observability_service_1.SecurityObservabilityService])
], SecurityObservabilityController);
