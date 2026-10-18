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
exports.DesktopAuthController = void 0;
const common_1 = require("@nestjs/common");
const auth_complex_service_1 = require("./auth-complex.service");
const rate_limit_policy_1 = require("../config/rate-limit.policy");
const throttler_1 = require("@nestjs/throttler");
/**
 * The desktop client's credential endpoints.
 *
 * A separate controller rather than two more routes on `auth-complex.controller.ts`,
 * because these are the only auth routes on the service that return a credential in the
 * response body. Keeping them together makes that fact obvious to anyone auditing the
 * auth surface, which is the point: the one exception to the cookie-only rule should be
 * findable in a single glance, not spread across a file that also sets cookies.
 *
 * Neither route sets a cookie. A desktop client has no cookie jar, and quietly handing it
 * one would leave a second, unnoticed credential path in the app.
 */
let DesktopAuthController = class DesktopAuthController {
    authComplexService;
    constructor(authComplexService) {
        this.authComplexService = authComplexService;
    }
    /**
     * Password, and MFA in one call.
     *
     * 202 with `requiresMfa` and a `challengeToken` when the account has MFA and no code was
     * sent, matching the web login's shape so the client has one MFA state to handle rather
     * than two.
     *
     * Throttled on its own budget, keyed per account+device rather than per IP. The reason
     * is in rate-limit.policy.ts: the web limit of 10 logins per 15 minutes is per IP, so a
     * whole office behind one NAT shares it and one person's typo loop locks out everyone.
     * This is a narrower budget for a narrower route -- a device grant is rarer than a page
     * load, and it is the one an attacker would script.
     */
    async token(req, res) {
        const result = (await this.authComplexService.desktopTokenGrant(req));
        // The status is set explicitly in both branches rather than left to Nest's POST default
        // of 201. Nothing here creates a resource addressable at a URL: it returns a credential,
        // and a client that reads 201 as "created, and here is where to GET it" will look for
        // one that does not exist.
        res.status(result?.status === "mfa_required" ? common_1.HttpStatus.ACCEPTED : common_1.HttpStatus.OK);
        res.json(result);
    }
    /**
     * Rotate both credentials.
     *
     * Given its own, looser budget than the grant. A 15-minute access token means a desktop
     * app legitimately refreshes on a timer, several times an hour, and that must not be
     * indistinguishable from password guessing -- but it must not be *unlimited* either, so
     * this stays a ceiling rather than being skipped.
     */
    async refresh(req, res) {
        // 200 explicitly, for the same reason as the grant: a rotated credential is not a
        // created resource, and a client that special-cases 201 will get it wrong here.
        const result = await this.authComplexService.desktopTokenRefresh(req);
        res.status(common_1.HttpStatus.OK);
        res.json(result);
    }
};
exports.DesktopAuthController = DesktopAuthController;
__decorate([
    (0, throttler_1.Throttle)({ default: { limit: (0, rate_limit_policy_1.ruleFor)("POST /api/auth/desktop/token").limit, ttl: (0, rate_limit_policy_1.ruleFor)("POST /api/auth/desktop/token").ttlMs } }),
    (0, common_1.Post)("token"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DesktopAuthController.prototype, "token", null);
__decorate([
    (0, throttler_1.Throttle)({ default: { limit: (0, rate_limit_policy_1.ruleFor)("POST /api/auth/desktop/refresh").limit, ttl: (0, rate_limit_policy_1.ruleFor)("POST /api/auth/desktop/refresh").ttlMs } }),
    (0, common_1.Post)("refresh"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DesktopAuthController.prototype, "refresh", null);
exports.DesktopAuthController = DesktopAuthController = __decorate([
    (0, common_1.Controller)("api/auth/desktop"),
    __metadata("design:paramtypes", [auth_complex_service_1.AuthComplexService])
], DesktopAuthController);
