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
exports.ActiveSessionService = void 0;
const common_1 = require("@nestjs/common");
const session_cookie_1 = require("../utils/session-cookie");
const auth_tokens_1 = require("../utils/auth-tokens");
const session_store_service_1 = require("./session-store.service");
/**
 * Resolves the caller to a live, non-revoked session.
 *
 * A JWT alone only proves the signature was valid at issue time, which leaves a
 * stolen token usable until it expires. Every authenticated request therefore
 * also confirms the session is still live, so logout and per-session revocation
 * take effect immediately.
 *
 * That liveness check used to be a `SELECT ... FROM user_sessions` on every
 * request. It now goes through `SessionStoreService` (Phase 3), which answers
 * from Redis and falls back to Postgres on a miss -- so revocation stays instant
 * while the hot path stops touching the database.
 */
let ActiveSessionService = class ActiveSessionService {
    sessions;
    constructor(sessions) {
        this.sessions = sessions;
    }
    async resolve(req) {
        const token = (0, session_cookie_1.readSessionToken)(req);
        if (!token)
            return null;
        const claims = (0, auth_tokens_1.verifyToken)(token);
        if (!claims || !Number.isInteger(claims.id))
            return null;
        const { session } = await this.sessions.findLiveSession(token);
        if (!session)
            return null;
        // The cached entry must belong to the account the JWT names. Redis is not an
        // authority here, so a mismatch is treated as no session rather than trusted.
        if (Number(session.accountId) !== Number(claims.id))
            return null;
        return { token, claims, accountId: Number(claims.id) };
    }
};
exports.ActiveSessionService = ActiveSessionService;
exports.ActiveSessionService = ActiveSessionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [session_store_service_1.SessionStoreService])
], ActiveSessionService);
