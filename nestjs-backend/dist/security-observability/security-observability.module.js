"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityObservabilityModule = void 0;
const common_1 = require("@nestjs/common");
const security_observability_controller_1 = require("./security-observability.controller");
const security_observability_scheduler_1 = require("./security-observability.scheduler");
const security_observability_service_1 = require("./security-observability.service");
const service_events_auth_guard_1 = require("./service-events-auth.guard");
let SecurityObservabilityModule = class SecurityObservabilityModule {
};
exports.SecurityObservabilityModule = SecurityObservabilityModule;
exports.SecurityObservabilityModule = SecurityObservabilityModule = __decorate([
    (0, common_1.Module)({
        controllers: [security_observability_controller_1.SecurityObservabilityController],
        providers: [security_observability_service_1.SecurityObservabilityService, service_events_auth_guard_1.ServiceEventsAuthGuard, security_observability_scheduler_1.SecurityObservabilityScheduler],
        exports: [security_observability_service_1.SecurityObservabilityService, service_events_auth_guard_1.ServiceEventsAuthGuard],
    })
], SecurityObservabilityModule);
