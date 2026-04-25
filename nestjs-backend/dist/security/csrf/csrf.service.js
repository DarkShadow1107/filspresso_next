"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsrfService = void 0;
const common_1 = require("@nestjs/common");
let CsrfService = class CsrfService {
    isProduction = process.env.NODE_ENV === "production";
    csrfRequireOriginForCookie = String(process.env.CSRF_REQUIRE_ORIGIN_FOR_COOKIE || "true")
        .trim()
        .toLowerCase() === "true";
    csrfEnforceFetchMetadata = String(process.env.CSRF_ENFORCE_FETCH_METADATA || "true")
        .trim()
        .toLowerCase() === "true";
    configuredOrigins = String(process.env.CORS_ORIGIN || "http://localhost:3000")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    isAllowedOrigin(origin) {
        if (!origin)
            return true;
        if (this.configuredOrigins.includes(origin))
            return true;
        if (!this.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
            return true;
        return false;
    }
};
exports.CsrfService = CsrfService;
exports.CsrfService = CsrfService = __decorate([
    (0, common_1.Injectable)()
], CsrfService);
