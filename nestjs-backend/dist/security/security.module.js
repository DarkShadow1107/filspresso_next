"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityModule = void 0;
const common_1 = require("@nestjs/common");
const opa_policy_service_1 = require("./policy/opa-policy.service");
const service_assertion_service_1 = require("./assertions/service-assertion.service");
const csrf_service_1 = require("./csrf/csrf.service");
let SecurityModule = class SecurityModule {
};
exports.SecurityModule = SecurityModule;
exports.SecurityModule = SecurityModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [opa_policy_service_1.OpaPolicyService, service_assertion_service_1.ServiceAssertionService, csrf_service_1.CsrfService],
        exports: [opa_policy_service_1.OpaPolicyService, service_assertion_service_1.ServiceAssertionService, csrf_service_1.CsrfService],
    })
], SecurityModule);
