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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const auth_service_1 = require("./auth.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
/**
 * AuthController — owns /api/auth/* routes.
 *
 * Most complex auth routes (register, login, OAuth, MFA setup/verify,
 * email verification) remain proxied through the legacy Express router
 * while being migrated incrementally. This controller owns the subset
 * of read-only / session management endpoints that are safe to cut over
 * immediately.
 *
 * Legacy passthrough (still in legacy-routes.ts):
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   GET  /api/auth/oauth/:provider/start
 *   GET  /api/auth/oauth/:provider/callback
 *   GET  /api/auth/verify-email
 *   POST /api/auth/mfa/setup
 *   POST /api/auth/mfa/verify-setup
 *   POST /api/auth/mfa/challenge
 *   POST /api/auth/mfa/verify
 *
 * NestJS-owned:
 *   GET  /api/auth/me
 *   POST /api/auth/logout
 *   GET  /api/auth/sessions
 *   DELETE /api/auth/sessions/:id
 *   PUT  /api/auth/change-password
 *   PUT  /api/auth/change-email
 *   GET  /api/auth/security-events
 *   GET  /api/auth/mfa/status
 *   POST /api/auth/mfa/disable
 *   GET  /api/auth/.well-known/openid-configuration
 *   GET  /api/auth/.well-known/jwks.json
 */
let AuthController = class AuthController {
    authService;
    constructor(authService) {
        this.authService = authService;
    }
    // ------------------------------------------------------------------ OIDC
    getOpenIdConfiguration(req) {
        if (!this.authService.getOidcAvailability()) {
            throw new common_1.ServiceUnavailableException({
                status: "error",
                message: "OIDC discovery is unavailable because JWT signing keys are not configured",
            });
        }
        const baseUrl = this.resolveBaseUrl(req);
        return this.authService.getOpenIdConfiguration(baseUrl);
    }
    getJwks() {
        if (!this.authService.getOidcAvailability()) {
            throw new common_1.ServiceUnavailableException({
                status: "error",
                message: "JWKS is unavailable because JWT signing keys are not configured",
            });
        }
        return this.authService.getJwks();
    }
    // ------------------------------------------------------------------ Me
    async getMe(req) {
        const accountId = Number(req.user?.id);
        const user = await this.authService.getMe(accountId);
        return { user };
    }
    // ------------------------------------------------------------------ Sessions
    async logout(req) {
        const authHeader = String(req.headers.authorization || "");
        if (authHeader.startsWith("Bearer ")) {
            const token = authHeader.slice(7).trim();
            await this.authService.invalidateSession(token);
        }
        return { message: "Logged out successfully" };
    }
    async getSessions(req) {
        const accountId = Number(req.user?.id);
        const sessions = await this.authService.getSessions(accountId);
        return { sessions };
    }
    async revokeSession(req, sessionId) {
        const accountId = Number(req.user?.id);
        await this.authService.revokeSession(accountId, sessionId);
        return { message: "Session revoked" };
    }
    // ------------------------------------------------------------------ Password / Email
    async changePassword(req) {
        const accountId = Number(req.user?.id);
        const { oldPassword, newPassword } = req.body;
        await this.authService.changePassword(accountId, String(oldPassword || ""), String(newPassword || ""));
        return { message: "Password changed successfully" };
    }
    async changeEmail(req) {
        const accountId = Number(req.user?.id);
        const { email } = req.body;
        await this.authService.changeEmail(accountId, String(email || ""));
        return { message: "Email updated. Please verify your new email address." };
    }
    // ------------------------------------------------------------------ Security events
    async getSecurityEvents(req) {
        const accountId = Number(req.user?.id);
        const rawLimit = Number.parseInt(String(req.query["limit"] || "20"), 10);
        const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
        const events = await this.authService.getSecurityEvents(accountId, limit);
        return { events };
    }
    // ------------------------------------------------------------------ MFA
    async getMfaStatus(req) {
        const accountId = Number(req.user?.id);
        return this.authService.getMfaStatus(accountId);
    }
    async disableMfa(req) {
        const accountId = Number(req.user?.id);
        const { password } = req.body;
        await this.authService.disableMfa(accountId, String(password || ""));
        return { message: "MFA disabled successfully" };
    }
    // ------------------------------------------------------------------ Helpers
    resolveBaseUrl(req) {
        const configured = String(process.env.BACKEND_PUBLIC_URL || "").trim();
        if (configured)
            return configured.replace(/\/$/, "");
        const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
            .split(",")[0]
            .trim() || "http";
        const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost:4000")
            .split(",")[0]
            .trim() || "localhost:4000";
        return `${protocol}://${host}`.replace(/\/$/, "");
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Get)(".well-known/openid-configuration"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], AuthController.prototype, "getOpenIdConfiguration", null);
__decorate([
    (0, common_1.Get)(".well-known/jwks.json"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], AuthController.prototype, "getJwks", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("me"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getMe", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("logout"),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("sessions"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getSessions", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Delete)("sessions/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "revokeSession", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Put)("change-password"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "changePassword", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Put)("change-email"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "changeEmail", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("security-events"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getSecurityEvents", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("mfa/status"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getMfaStatus", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("mfa/disable"),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "disableMfa", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)("api/auth"),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
