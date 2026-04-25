"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const authTokens = __importStar(require("../common/utils/auth-tokens"));
const passwords = __importStar(require("../common/utils/passwords"));
let AuthService = class AuthService {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Validate a Bearer token and return user claims.
     */
    verifyBearerToken(token) {
        const decoded = authTokens.verifyToken(token);
        if (!decoded) {
            throw new common_1.UnauthorizedException({ error: "Invalid or expired token" });
        }
        return decoded;
    }
    /**
     * Retrieve the authenticated user from the database by account ID from JWT claims.
     */
    async getMe(accountId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT id, username, email, name, icon, role, created_at, subscription,
                user_mfa_enabled, email_verified
         FROM accounts WHERE id = $1 LIMIT 1`, [accountId]);
            const user = result.rows[0];
            if (!user) {
                throw new common_1.NotFoundException({ error: "Account not found" });
            }
            return user;
        }
        finally {
            client.release();
        }
    }
    /**
     * Invalidate a session token (logout).
     */
    async invalidateSession(token) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("DELETE FROM user_sessions WHERE session_token = $1", [token]);
        }
        catch {
            // Best-effort logout — do not fail the response on DB error
        }
        finally {
            client.release();
        }
    }
    /**
     * List active sessions for an account.
     */
    async getSessions(accountId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT id, ip_address, user_agent, created_at, expires_at
         FROM user_sessions
         WHERE account_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC`, [accountId]);
            return result.rows;
        }
        finally {
            client.release();
        }
    }
    /**
     * Revoke a specific session belonging to an account.
     */
    async revokeSession(accountId, sessionId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query("DELETE FROM user_sessions WHERE id = $1 AND account_id = $2 RETURNING id", [sessionId, accountId]);
            if (!result.rowCount) {
                throw new common_1.NotFoundException({ error: "Session not found" });
            }
        }
        finally {
            client.release();
        }
    }
    /**
     * Change password — verifies old password, hashes new one.
     */
    async changePassword(accountId, oldPassword, newPassword) {
        if (typeof newPassword !== "string" ||
            newPassword.length < 8 ||
            newPassword.length > 128) {
            throw new common_1.BadRequestException({
                error: "New password must be between 8 and 128 characters",
            });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query("SELECT password_hash FROM accounts WHERE id = $1 LIMIT 1", [accountId]);
            const row = result.rows[0];
            if (!row) {
                throw new common_1.NotFoundException({ error: "Account not found" });
            }
            const valid = await passwords.verifyPassword(oldPassword, String(row.password_hash));
            if (!valid) {
                throw new common_1.UnauthorizedException({ error: "Current password is incorrect" });
            }
            const newHash = await passwords.hashPassword(newPassword);
            await client.query("UPDATE accounts SET password_hash = $1, updated_at = NOW() WHERE id = $2", [newHash, accountId]);
        }
        finally {
            client.release();
        }
    }
    /**
     * Change email — updates and marks as unverified.
     */
    async changeEmail(accountId, newEmail) {
        const normalized = String(newEmail || "")
            .trim()
            .toLowerCase()
            .slice(0, 254);
        if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
            throw new common_1.BadRequestException({ error: "Invalid email address" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const existing = await client.query("SELECT id FROM accounts WHERE email = $1 AND id != $2 LIMIT 1", [normalized, accountId]);
            if (existing.rows[0]) {
                throw new common_1.BadRequestException({ error: "Email already in use" });
            }
            await client.query("UPDATE accounts SET email = $1, email_verified = FALSE, updated_at = NOW() WHERE id = $2", [normalized, accountId]);
        }
        finally {
            client.release();
        }
    }
    /**
     * Get recent auth security events for an account.
     */
    async getSecurityEvents(accountId, limit = 20) {
        const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 20, 1), 200);
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT event_type, ip_address, user_agent, occurred_at, details
         FROM auth_security_events
         WHERE account_id = $1
         ORDER BY occurred_at DESC
         LIMIT $2`, [accountId, safeLimit]);
            return result.rows;
        }
        catch {
            // auth_security_events table may not exist in older schema
            return [];
        }
        finally {
            client.release();
        }
    }
    /**
     * Get MFA status for an account.
     */
    async getMfaStatus(accountId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query("SELECT user_mfa_enabled FROM accounts WHERE id = $1 LIMIT 1", [accountId]);
            return { enabled: Boolean(result.rows[0]?.user_mfa_enabled) };
        }
        finally {
            client.release();
        }
    }
    /**
     * Disable MFA for an account (after password verification).
     */
    async disableMfa(accountId, password) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query("SELECT password_hash FROM accounts WHERE id = $1 LIMIT 1", [accountId]);
            const row = result.rows[0];
            if (!row)
                throw new common_1.NotFoundException({ error: "Account not found" });
            const valid = await passwords.verifyPassword(password, String(row.password_hash));
            if (!valid) {
                throw new common_1.UnauthorizedException({ error: "Password is incorrect" });
            }
            await client.query(`UPDATE accounts
         SET user_mfa_enabled = FALSE,
             user_mfa_secret_encrypted = NULL,
             updated_at = NOW()
         WHERE id = $1`, [accountId]);
        }
        finally {
            client.release();
        }
    }
    /**
     * Get OIDC configuration availability.
     */
    getOidcAvailability() {
        try {
            return authTokens.jwtSupportsOidcJwks();
        }
        catch {
            return false;
        }
    }
    /**
     * Get OIDC configuration document.
     */
    getOpenIdConfiguration(baseUrl) {
        return authTokens.getOpenIdConfiguration(baseUrl);
    }
    /**
     * Get JWKS.
     */
    getJwks() {
        return authTokens.getJwtJwks();
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], AuthService);
