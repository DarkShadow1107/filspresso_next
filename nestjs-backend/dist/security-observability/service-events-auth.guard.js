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
exports.ServiceEventsAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const service_assertion_service_1 = require("../security/assertions/service-assertion.service");
let ServiceEventsAuthGuard = class ServiceEventsAuthGuard {
    serviceAssertionService;
    serviceEventsApiKey = String(process.env.SERVICE_EVENTS_API_KEY || "");
    internalServiceAssertionStrict = String(process.env.INTERNAL_SERVICE_ASSERTION_STRICT || "true")
        .trim()
        .toLowerCase() === "true";
    constructor(serviceAssertionService) {
        this.serviceAssertionService = serviceAssertionService;
    }
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const serviceName = String(request.headers["x-service-name"] || "")
            .trim()
            .slice(0, 128) || "service-events-client";
        const assertionHeader = String(request.headers["x-service-assertion"] || "").trim();
        const authHeader = String(request.headers.authorization || "").trim();
        const assertionAuthorization = authHeader.startsWith("Assertion ") ? authHeader.slice(10).trim() : "";
        const assertionToken = assertionHeader || assertionAuthorization;
        const operationIdHeader = String(request.headers["x-operation-id"] || "").trim();
        if (this.internalServiceAssertionStrict && !assertionToken) {
            throw new common_1.UnauthorizedException({ error: "Service assertion token required" });
        }
        if (!this.serviceEventsApiKey && !assertionToken) {
            throw new common_1.ServiceUnavailableException({ error: "Service events ingestion is disabled" });
        }
        if (assertionToken) {
            const assertion = this.serviceAssertionService.verify(assertionToken, "service-events:write", this.internalServiceAssertionStrict);
            if (assertion.ok) {
                const claims = assertion.claims && typeof assertion.claims === "object" ? assertion.claims : {};
                const operationIdClaim = String(claims.op_id || "").trim();
                if (this.internalServiceAssertionStrict &&
                    operationIdHeader &&
                    operationIdClaim &&
                    operationIdHeader !== operationIdClaim) {
                    throw new common_1.UnauthorizedException({
                        error: "Invalid service assertion",
                        reason: "operation_id_mismatch",
                    });
                }
                request.serviceIdentity = {
                    actor_type: "service",
                    service_name: String(claims.sub || serviceName).slice(0, 128),
                    role: "service",
                };
                request.serviceAssertion = claims;
                return true;
            }
            if (this.internalServiceAssertionStrict || !this.serviceEventsApiKey) {
                throw new common_1.UnauthorizedException({
                    error: "Invalid service assertion",
                    reason: assertion.reason || "verification_failed",
                });
            }
        }
        if (this.internalServiceAssertionStrict) {
            throw new common_1.UnauthorizedException({
                error: "Invalid service assertion",
                reason: "assertion_required",
            });
        }
        const headerKey = String(request.headers["x-service-events-key"] || "").trim();
        if (headerKey && headerKey === this.serviceEventsApiKey) {
            request.serviceIdentity = {
                actor_type: "service",
                service_name: serviceName,
                role: "service",
            };
            return true;
        }
        if (authHeader.startsWith("Bearer ")) {
            const bearerKey = authHeader.slice(7).trim();
            if (bearerKey === this.serviceEventsApiKey) {
                request.serviceIdentity = {
                    actor_type: "service",
                    service_name: serviceName,
                    role: "service",
                };
                return true;
            }
        }
        throw new common_1.UnauthorizedException({ error: "Unauthorized service events request" });
    }
};
exports.ServiceEventsAuthGuard = ServiceEventsAuthGuard;
exports.ServiceEventsAuthGuard = ServiceEventsAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [service_assertion_service_1.ServiceAssertionService])
], ServiceEventsAuthGuard);
