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
exports.AdminService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const crypto = __importStar(require("crypto"));
const path = __importStar(require("path"));
const passwords = __importStar(require("../common/utils/passwords"));
const encryption = __importStar(require("../common/utils/encryption"));
const QRCode = require("qrcode");
const ADMIN_SENSITIVE_VIEW_COOKIE_NAME = "admin_sensitive_view";
const ADMIN_SENSITIVE_VIEW_TIMEOUT_MS = 10 * 60 * 1000;
const RESTRICTED_ADMIN_TABLES = new Set(["auth_login_attempts", "auth_security_events", "admin_mfa_challenges", "user_mfa_challenges", "user_sessions", "user_cards"]);
const SENSITIVE_ADMIN_COLUMNS = new Set(["password_hash", "session_token", "challenge_token_hash", "admin_mfa_secret_encrypted", "user_mfa_secret_encrypted", "temp_secret_encrypted", "access_token", "refresh_token", "client_secret", "api_key", "jwt_secret", "encryption_key", "google_oauth_client_secret", "google_oauth_refresh_token"]);
const ADMIN_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const ADMIN_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const IS_NON_PROD = process.env.NODE_ENV !== "production";
const RELAX_ADMIN_LIMITS_IN_DEV = IS_NON_PROD && process.env.ENABLE_STRICT_ADMIN_LIMITS !== "true" && process.env.DISABLE_RATE_LIMIT !== "false";
const VALID_IMAGE_EXTENSIONS = new Set(["png", "avif", "webp", "jpg", "jpeg", "svg"]);
const ADMIN_QUERY_MAX_LENGTH = Math.max(64, Number.parseInt(process.env.ADMIN_QUERY_MAX_LENGTH || "5000", 10));
const ADMIN_QUERY_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.ADMIN_QUERY_TIMEOUT_MS || "4000", 10));
const ADMIN_MFA_ISSUER = String(process.env.ADMIN_MFA_ISSUER || "Filspresso").slice(0, 64);
const ADMIN_MFA_CODE_DIGITS = 6;
const ADMIN_MFA_TIME_STEP_SECONDS = Math.max(15, Number.parseInt(process.env.ADMIN_MFA_TIME_STEP_SECONDS || "30", 10));
const ADMIN_MFA_ALLOWED_DRIFT_STEPS = Math.max(0, Number.parseInt(process.env.ADMIN_MFA_ALLOWED_DRIFT_STEPS || "1", 10));
const ADMIN_MFA_VERIFY_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.ADMIN_MFA_VERIFY_TTL_SECONDS || "300", 10));
const ADMIN_MFA_ENROLL_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.ADMIN_MFA_ENROLL_TTL_SECONDS || "600", 10));
const ADMIN_AUTH_LOCK_THRESHOLD = Math.max(3, Number.parseInt(process.env.ADMIN_AUTH_LOCK_THRESHOLD || "5", 10));
const ADMIN_AUTH_FAILURE_WINDOW_MINUTES = Math.max(1, Number.parseInt(process.env.ADMIN_AUTH_FAILURE_WINDOW_MINUTES || "30", 10));
const ADMIN_AUTH_LOCK_BASE_SECONDS = Math.max(5, Number.parseInt(process.env.ADMIN_AUTH_LOCK_BASE_SECONDS || "60", 10));
const ADMIN_AUTH_LOCK_MAX_SECONDS = Math.max(ADMIN_AUTH_LOCK_BASE_SECONDS, Number.parseInt(process.env.ADMIN_AUTH_LOCK_MAX_SECONDS || "1800", 10));
const ADMIN_IP_ALLOWLIST = String(process.env.ADMIN_IP_ALLOWLIST || "").split(",").map((entry) => entry.trim()).filter(Boolean);
const CATEGORY_FOLDER_MAP = {
    original: { "coffee+": "Coffee+", "craft brew": "Craft Brew", "creations barista": "Barista Creations", "barista creations": "Barista Creations", espresso: "Espresso", "edition limitee": "Limited Edition", "limited edition": "Limited Edition", "ispirazione italiana": "Ispirazione Italiana", "italian explorations": "Italian Explorations", "origines principales": "Master Origins", "master origins": "Master Origins", "explorations du monde": "World Explorations", "world explorations": "World Explorations", tasse: "Mug", mug: "Mug" },
    vertuo: { "coffee+": "Coffee+", "craft brew": "Craft Brew", "double espresso": "Double Espresso", espresso: "Espressos", espressos: "Espressos", "gran lungo": "Gran Lungo", "edition limitee": "Limited Edition", "limited edition": "Limited Edition", "barista creation": "Barista Creation", "barista creations": "Barista Creation", "creations barista": "Barista Creation", "master origins": "Master Origins", "origines principales": "Master Origins", mug: "Mug", tasse: "Mug" },
};
let AdminService = class AdminService {
    db;
    constructor(db) {
        this.db = db;
    }
    normalizeAdminIdentifier(value) { return String(value || "").trim().toLowerCase(); }
    isRestrictedAdminTable(table) { return RESTRICTED_ADMIN_TABLES.has(this.normalizeAdminIdentifier(table)); }
    isSensitiveAdminColumn(columnName) {
        const normalized = this.normalizeAdminIdentifier(columnName);
        return SENSITIVE_ADMIN_COLUMNS.has(normalized) || normalized.endsWith("_secret") || normalized.endsWith("_secret_encrypted") || normalized.endsWith("_token") || normalized.endsWith("_token_hash");
    }
    getVisibleAdminColumns(columns) { return columns.filter(c => !this.isSensitiveAdminColumn(c.name)); }
    getCookieValue(req, name) {
        const rawCookie = String(req.headers.cookie || "");
        if (!rawCookie)
            return "";
        for (const part of rawCookie.split(";")) {
            const [key, ...rest] = part.split("=");
            if (key && key.trim() === name)
                return decodeURIComponent(rest.join("=").trim() || "");
        }
        return "";
    }
    getSensitiveViewSecret() { return String(process.env.JWT_SECRET || process.env.ENCRYPTION_KEY || "").trim(); }
    buildSensitiveViewTokenPayload(session) {
        return { scope: "admin_sensitive_view", userId: session.userId, username: session.username, iat: Date.now(), exp: Date.now() + ADMIN_SENSITIVE_VIEW_TIMEOUT_MS };
    }
    signSensitiveViewToken(payload) {
        const secret = this.getSensitiveViewSecret();
        if (!secret)
            return "";
        const serialized = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
        const signature = crypto.createHmac("sha256", secret).update(serialized).digest("base64url");
        return `${serialized}.${signature}`;
    }
    verifySensitiveViewToken(token) {
        const secret = this.getSensitiveViewSecret();
        if (!secret || typeof token !== "string" || !token.includes("."))
            return null;
        const [serialized, signature] = token.split(".");
        if (!serialized || !signature)
            return null;
        const expectedSignature = crypto.createHmac("sha256", secret).update(serialized).digest("base64url");
        if (expectedSignature !== signature)
            return null;
        try {
            const payload = JSON.parse(Buffer.from(serialized, "base64url").toString("utf8"));
            if (!payload || payload.scope !== "admin_sensitive_view" || !Number.isFinite(payload.exp) || payload.exp < Date.now())
                return null;
            return payload;
        }
        catch {
            return null;
        }
    }
    setSensitiveViewCookie(res, token) {
        res.cookie(ADMIN_SENSITIVE_VIEW_COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/admin", maxAge: ADMIN_SENSITIVE_VIEW_TIMEOUT_MS });
    }
    clearSensitiveViewCookie(res) {
        res.cookie(ADMIN_SENSITIVE_VIEW_COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/admin", maxAge: 0 });
    }
    normalizeIp(ip = "") {
        const clean = String(ip || "").split(",")[0].trim().replace(/^\[|\]$/g, "");
        if (clean.startsWith("::ffff:"))
            return clean.replace("::ffff:", "");
        return clean;
    }
    getRequestIp(req) {
        const forwarded = req.headers["x-forwarded-for"];
        const source = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.ip || req.socket?.remoteAddress || "";
        return this.normalizeIp(source);
    }
    isIpAllowed(ip) {
        if (ADMIN_IP_ALLOWLIST.length === 0)
            return true;
        const normalized = this.normalizeIp(ip);
        return ADMIN_IP_ALLOWLIST.some((entry) => this.normalizeIp(entry) === normalized);
    }
    isAllowedImage(file) {
        const ext = path.extname(file.originalname || "").toLowerCase().replace(".", "");
        const mime = (file.mimetype || "").toLowerCase();
        if (VALID_IMAGE_EXTENSIONS.has(ext))
            return true;
        if (mime.includes("image/avif") || mime.includes("image/webp") || mime.includes("image/png") || mime.includes("jpeg") || mime.includes("image/svg+xml"))
            return true;
        return false;
    }
    resolveImageTarget(productType, category) {
        const typeKey = (productType || "").toLowerCase() === "vertuo" ? "vertuo" : "original";
        const categoryKey = category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const mapped = CATEGORY_FOLDER_MAP[typeKey]?.[categoryKey];
        const categoryDir = mapped || category || "Uncategorized";
        const typeDir = typeKey === "vertuo" ? "Vertuo" : "Original";
        const relativeDir = path.join("images", "Capsules", typeDir, categoryDir);
        const absoluteDir = path.join(process.cwd(), "public", relativeDir);
        return { typeDir, categoryDir, relativeDir, absoluteDir };
    }
    generateAdminToken() { return `admin_${crypto.randomBytes(32).toString("hex")}`; }
    normalizeAdminLoginKey(value) { return String(value || "").trim().toLowerCase().slice(0, 254); }
    computeLockSeconds(failedAttempts) {
        if (failedAttempts < ADMIN_AUTH_LOCK_THRESHOLD)
            return 0;
        const exponent = Math.max(0, failedAttempts - ADMIN_AUTH_LOCK_THRESHOLD);
        const calculated = ADMIN_AUTH_LOCK_BASE_SECONDS * 2 ** exponent;
        return Math.min(calculated, ADMIN_AUTH_LOCK_MAX_SECONDS);
    }
    async getAdminLockState(client, loginKey) {
        if (RELAX_ADMIN_LIMITS_IN_DEV)
            return { isLocked: false, retryAfterSeconds: 0, failedAttempts: 0 };
        const result = await client.query(`SELECT failed_attempts, lock_until FROM auth_login_attempts WHERE login_key = $1 LIMIT 1`, [loginKey]);
        const row = result.rows[0];
        if (!row)
            return { isLocked: false, retryAfterSeconds: 0, failedAttempts: 0 };
        const lockUntil = row.lock_until ? new Date(row.lock_until) : null;
        if (!lockUntil || Number.isNaN(lockUntil.getTime()) || lockUntil <= new Date())
            return { isLocked: false, retryAfterSeconds: 0, failedAttempts: Number(row.failed_attempts) || 0 };
        const retryAfterSeconds = Math.max(1, Math.ceil((lockUntil.getTime() - Date.now()) / 1000));
        return { isLocked: true, retryAfterSeconds, failedAttempts: Number(row.failed_attempts) || 0 };
    }
    async recordAdminFailedAttempt(client, loginKey) {
        const result = await client.query(`INSERT INTO auth_login_attempts (login_key, failed_attempts, first_failed_at, last_failed_at, lock_until, updated_at) VALUES ($1, 1, NOW(), NOW(), NULL, NOW()) ON CONFLICT (login_key) DO UPDATE SET failed_attempts = CASE WHEN auth_login_attempts.last_failed_at IS NULL OR auth_login_attempts.last_failed_at < NOW() - (($2)::text || ' minutes')::interval THEN 1 ELSE auth_login_attempts.failed_attempts + 1 END, first_failed_at = CASE WHEN auth_login_attempts.last_failed_at IS NULL OR auth_login_attempts.last_failed_at < NOW() - (($2)::text || ' minutes')::interval THEN NOW() ELSE auth_login_attempts.first_failed_at END, last_failed_at = NOW(), updated_at = NOW() RETURNING failed_attempts`, [loginKey, ADMIN_AUTH_FAILURE_WINDOW_MINUTES]);
        const failedAttempts = Number(result.rows[0]?.failed_attempts) || 1;
        const lockSeconds = this.computeLockSeconds(failedAttempts);
        if (lockSeconds > 0)
            await client.query("UPDATE auth_login_attempts SET lock_until = NOW() + (($1)::text || ' seconds')::interval WHERE login_key = $2", [lockSeconds, loginKey]);
        return { failedAttempts, lockSeconds };
    }
    async clearAdminFailedAttempts(client, loginKey) { await client.query("DELETE FROM auth_login_attempts WHERE login_key = $1", [loginKey]); }
    async logAdminSecurityEvent(client, eventType, payload = {}) {
        const loginKey = payload.loginKey ? String(payload.loginKey).slice(0, 254) : null;
        const accountId = Number.isInteger(payload.accountId) ? payload.accountId : null;
        const ipAddress = payload.ipAddress ? String(payload.ipAddress).slice(0, 64) : null;
        const userAgent = payload.userAgent ? String(payload.userAgent).slice(0, 500) : null;
        const details = payload.details && typeof payload.details === "object" ? payload.details : {};
        await client.query(`INSERT INTO auth_security_events (event_type, login_key, account_id, ip_address, user_agent, details) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [eventType, loginKey, accountId, ipAddress, userAgent, JSON.stringify(details)]);
    }
    hashChallengeToken(token) { return crypto.createHash("sha256").update(String(token || "")).digest("hex"); }
    generateBase32Secret(length = 32) {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        const bytes = crypto.randomBytes(length);
        let output = "";
        for (let i = 0; i < bytes.length; i += 1)
            output += alphabet[bytes[i] % alphabet.length];
        return output;
    }
    decodeBase32(base32) {
        const clean = String(base32 || "").toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let bits = "";
        for (const char of clean) {
            const value = alphabet.indexOf(char);
            if (value < 0)
                continue;
            bits += value.toString(2).padStart(5, "0");
        }
        const bytes = [];
        for (let i = 0; i + 8 <= bits.length; i += 8)
            bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
        return Buffer.from(bytes);
    }
    generateTotp(secret, timestampMs = Date.now()) {
        const key = this.decodeBase32(secret);
        if (!key.length)
            return null;
        const counter = Math.floor(timestampMs / 1000 / ADMIN_MFA_TIME_STEP_SECONDS);
        const counterBuffer = Buffer.alloc(8);
        counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
        counterBuffer.writeUInt32BE(counter >>> 0, 4);
        const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
        const offset = hmac[hmac.length - 1] & 0x0f;
        const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
        const code = String(binary % 10 ** ADMIN_MFA_CODE_DIGITS).padStart(ADMIN_MFA_CODE_DIGITS, "0");
        return code;
    }
    verifyTotp(secret, submittedCode) {
        const normalizedCode = String(submittedCode || "").trim().replace(/\s+/g, "");
        if (!/^\d{6,8}$/.test(normalizedCode))
            return false;
        for (let drift = -ADMIN_MFA_ALLOWED_DRIFT_STEPS; drift <= ADMIN_MFA_ALLOWED_DRIFT_STEPS; drift += 1) {
            const timestamp = Date.now() + drift * ADMIN_MFA_TIME_STEP_SECONDS * 1000;
            const code = this.generateTotp(secret, timestamp);
            if (code && code === normalizedCode)
                return true;
        }
        return false;
    }
    buildOtpAuthUrl(secret, username) {
        const accountName = encodeURIComponent(String(username || "admin").trim().toLowerCase());
        const issuer = encodeURIComponent(ADMIN_MFA_ISSUER);
        return `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${ADMIN_MFA_CODE_DIGITS}&period=${ADMIN_MFA_TIME_STEP_SECONDS}`;
    }
    async generateAdminQrDataUrl(otpauthUrl) {
        try {
            return await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: "M", margin: 1, width: 220 });
        }
        catch {
            return null;
        }
    }
    async createAdminMfaChallenge(client, opts) {
        const token = `mfa_${crypto.randomBytes(48).toString("hex")}`;
        const tokenHash = this.hashChallengeToken(token);
        const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000);
        await client.query(`INSERT INTO admin_mfa_challenges (account_id, challenge_token_hash, purpose, temp_secret_encrypted, expires_at) VALUES ($1, $2, $3, $4, $5)`, [opts.accountId, tokenHash, opts.purpose, opts.tempSecretEncrypted, expiresAt]);
        return { token, expiresIn: opts.ttlSeconds };
    }
    async getActiveMfaChallenge(client, token) {
        const tokenHash = this.hashChallengeToken(token);
        const result = await client.query(`SELECT c.id, c.account_id, c.purpose, c.temp_secret_encrypted, c.attempts, c.max_attempts, c.expires_at, a.username, a.role, a.admin_mfa_enabled, a.admin_mfa_secret_encrypted FROM admin_mfa_challenges c JOIN accounts a ON a.id = c.account_id WHERE c.challenge_token_hash = $1 AND c.consumed_at IS NULL LIMIT 1`, [tokenHash]);
        return result.rows[0] || null;
    }
    async invalidateExpiredChallenges(client) { await client.query("DELETE FROM admin_mfa_challenges WHERE consumed_at IS NOT NULL OR expires_at < NOW()"); }
    async createAdminSession(client, user, req) {
        const token = this.generateAdminToken();
        const expiresAt = new Date(Date.now() + ADMIN_SESSION_TIMEOUT_MS);
        await client.query("INSERT INTO user_sessions (account_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)", [user.id, token, expiresAt, this.getRequestIp(req) || null, String(req.headers["user-agent"] || "").slice(0, 500) || null]);
        return { token, expiresIn: Math.floor(ADMIN_SESSION_TIMEOUT_MS / 1000) };
    }
    isSafeReadOnlyAdminQuery(sql) {
        const normalized = String(sql || "").trim();
        if (!normalized)
            return false;
        if (normalized.length > ADMIN_QUERY_MAX_LENGTH)
            return false;
        if (normalized.includes(";") || /--|\/\*/.test(normalized))
            return false;
        const upper = normalized.toUpperCase();
        if (!(upper.startsWith("SELECT") || upper.startsWith("WITH") || upper.startsWith("SHOW") || upper.startsWith("DESCRIBE")))
            return false;
        if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|MERGE|CALL|COPY|DO|EXECUTE)\b/.test(upper))
            return false;
        return true;
    }
    isSafeSqlIdentifier(value) { return ADMIN_IDENTIFIER_PATTERN.test(String(value || "")); }
    async authenticateAdmin(req, res) {
        req.__adminService = this; // Expose to Multer interceptor
        const ip = this.getRequestIp(req);
        if (!this.isIpAllowed(ip)) {
            res.status(403).json({ error: "Admin access is restricted from this network" });
            return;
        }
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            res.status(401).json({ error: "Admin authentication required" });
            return;
        }
        const token = authHeader.substring(7).trim();
        if (!token) {
            res.status(401).json({ error: "Invalid or expired admin session" });
            return;
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const sessionResult = await client.query(`SELECT s.account_id, a.username FROM user_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.session_token = $1 AND s.expires_at > NOW() AND a.role = 'admin' LIMIT 1`, [token]);
            const session = sessionResult.rows[0];
            if (!session) {
                res.status(401).json({ error: "Invalid or expired admin session" });
                return;
            }
            const expiresAt = new Date(Date.now() + ADMIN_SESSION_TIMEOUT_MS);
            await client.query("UPDATE user_sessions SET expires_at = $1 WHERE session_token = $2", [expiresAt, token]);
            req.adminSession = { username: session.username, userId: session.account_id, expiresAt: expiresAt.getTime() };
            const sensitiveViewToken = this.getCookieValue(req, ADMIN_SENSITIVE_VIEW_COOKIE_NAME);
            const sensitiveViewPayload = this.verifySensitiveViewToken(sensitiveViewToken);
            req.adminSensitiveView = Boolean(sensitiveViewPayload && sensitiveViewPayload.userId === session.account_id && sensitiveViewPayload.username === session.username);
        }
        finally {
            client.release();
        }
    }
    async login(req, res) {
        const ip = this.getRequestIp(req);
        if (!this.isIpAllowed(ip)) {
            res.status(403).json({ error: "Admin access is restricted from this network" });
            return;
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const username = String(req.body?.username || "").trim().toLowerCase().slice(0, 64);
            const password = typeof req.body?.password === "string" ? req.body.password : "";
            const loginKey = this.normalizeAdminLoginKey(`admin:${username}`);
            const ipAddress = this.getRequestIp(req) || null;
            const userAgent = String(req.headers["user-agent"] || "").slice(0, 500) || null;
            const includeQrCode = Boolean(req.body?.includeQrCode);
            if (!username || !password || password.length > 128)
                throw new common_1.BadRequestException({ error: "Username and password are required" });
            await this.invalidateExpiredChallenges(client);
            const lockState = await this.getAdminLockState(client, loginKey);
            if (lockState.isLocked) {
                await this.logAdminSecurityEvent(client, "admin_login_locked", { loginKey, ipAddress, userAgent, details: { retryAfterSeconds: lockState.retryAfterSeconds, failedAttempts: lockState.failedAttempts } });
                res.setHeader("Retry-After", String(lockState.retryAfterSeconds));
                throw new common_1.HttpException({ error: "Too many failed admin login attempts. Please try again later.", retryAfterSeconds: lockState.retryAfterSeconds }, 429);
            }
            const result = await client.query("SELECT id, username, role, password_hash, admin_mfa_enabled, admin_mfa_secret_encrypted FROM accounts WHERE LOWER(username) = $1 AND role = 'admin'", [username]);
            if (result.rows.length === 0) {
                const failed = await this.recordAdminFailedAttempt(client, loginKey);
                await this.logAdminSecurityEvent(client, "admin_login_failed", { loginKey, ipAddress, userAgent, details: { reason: "unknown_admin", failedAttempts: failed.failedAttempts, lockSeconds: failed.lockSeconds } });
                throw new common_1.UnauthorizedException({ error: "Invalid credentials" });
            }
            const user = result.rows[0];
            const isValid = await passwords.verifyPassword(password, user.password_hash);
            if (!isValid) {
                const failed = await this.recordAdminFailedAttempt(client, loginKey);
                await this.logAdminSecurityEvent(client, "admin_login_failed", { loginKey, accountId: user.id, ipAddress, userAgent, details: { reason: "bad_password", failedAttempts: failed.failedAttempts, lockSeconds: failed.lockSeconds } });
                throw new common_1.UnauthorizedException({ error: "Invalid credentials" });
            }
            if (passwords.needsPasswordRehash(user.password_hash)) {
                try {
                    const upgradedPasswordHash = await passwords.hashPassword(password);
                    await client.query("UPDATE accounts SET password_hash = $1, updated_at = NOW() WHERE id = $2", [upgradedPasswordHash, user.id]);
                }
                catch { }
            }
            await this.clearAdminFailedAttempts(client, loginKey);
            if (user.admin_mfa_enabled && user.admin_mfa_secret_encrypted) {
                const challenge = await this.createAdminMfaChallenge(client, { accountId: user.id, purpose: "verify", ttlSeconds: ADMIN_MFA_VERIFY_TTL_SECONDS });
                await this.logAdminSecurityEvent(client, "admin_mfa_challenge_created", { loginKey, accountId: user.id, ipAddress, userAgent, details: { purpose: "verify", expiresIn: challenge.expiresIn } });
                return { status: "mfa_required", requiresMfa: true, challengeToken: challenge.token, expiresIn: challenge.expiresIn, message: "MFA verification required" };
            }
            const enrollmentSecret = this.generateBase32Secret(32);
            const challenge = await this.createAdminMfaChallenge(client, { accountId: user.id, purpose: "enroll", ttlSeconds: ADMIN_MFA_ENROLL_TTL_SECONDS, tempSecretEncrypted: encryption.encrypt(enrollmentSecret) });
            await this.logAdminSecurityEvent(client, "admin_mfa_enrollment_required", { loginKey, accountId: user.id, ipAddress, userAgent, details: { expiresIn: challenge.expiresIn } });
            const otpauthUrl = this.buildOtpAuthUrl(enrollmentSecret, user.username);
            const totp = { secret: enrollmentSecret, issuer: ADMIN_MFA_ISSUER, accountName: user.username, otpauthUrl };
            if (includeQrCode)
                totp.qrDataUrl = await this.generateAdminQrDataUrl(otpauthUrl);
            return { status: "mfa_enrollment_required", requiresMfaEnrollment: true, challengeToken: challenge.token, expiresIn: challenge.expiresIn, message: "MFA setup is required for admin accounts", totp };
        }
        finally {
            client.release();
        }
    }
    async mfaVerify(req, res) {
        const ip = this.getRequestIp(req);
        if (!this.isIpAllowed(ip)) {
            res.status(403).json({ error: "Admin access is restricted from this network" });
            return;
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const challengeToken = String(req.body?.challengeToken || "").trim();
            const code = String(req.body?.code || "").trim().replace(/\s+/g, "");
            const ipAddress = this.getRequestIp(req) || null;
            const userAgent = String(req.headers["user-agent"] || "").slice(0, 500) || null;
            if (!challengeToken || !code)
                throw new common_1.BadRequestException({ error: "challengeToken and code are required" });
            await this.invalidateExpiredChallenges(client);
            const challenge = await this.getActiveMfaChallenge(client, challengeToken);
            if (!challenge || challenge.role !== "admin")
                throw new common_1.UnauthorizedException({ error: "Invalid or expired MFA challenge" });
            const expiresAt = new Date(challenge.expires_at);
            if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())
                throw new common_1.UnauthorizedException({ error: "Invalid or expired MFA challenge" });
            if (Number(challenge.attempts) >= Number(challenge.max_attempts))
                throw new common_1.HttpException({ error: "Too many MFA attempts. Start login again." }, 429);
            const secret = challenge.purpose === "verify" ? (challenge.admin_mfa_secret_encrypted ? encryption.decrypt(challenge.admin_mfa_secret_encrypted) : "") : (challenge.temp_secret_encrypted ? encryption.decrypt(challenge.temp_secret_encrypted) : "");
            if (!secret)
                throw new common_1.UnauthorizedException({ error: "MFA challenge is no longer valid" });
            const validCode = this.verifyTotp(secret, code);
            if (!validCode) {
                await client.query("UPDATE admin_mfa_challenges SET attempts = attempts + 1 WHERE id = $1", [challenge.id]);
                await this.logAdminSecurityEvent(client, "admin_mfa_failed", { loginKey: `admin:${challenge.username}`, accountId: challenge.account_id, ipAddress, userAgent, details: { purpose: challenge.purpose } });
                throw new common_1.UnauthorizedException({ error: "Invalid MFA code" });
            }
            if (challenge.purpose === "enroll") {
                await client.query("UPDATE accounts SET admin_mfa_enabled = TRUE, admin_mfa_secret_encrypted = $1, admin_mfa_enabled_at = NOW() WHERE id = $2", [encryption.encrypt(secret), challenge.account_id]);
            }
            await client.query("UPDATE admin_mfa_challenges SET consumed_at = NOW() WHERE id = $1", [challenge.id]);
            const session = await this.createAdminSession(client, { id: challenge.account_id }, req);
            await this.logAdminSecurityEvent(client, "admin_login_success_mfa", { loginKey: `admin:${challenge.username}`, accountId: challenge.account_id, ipAddress, userAgent, details: { purpose: challenge.purpose } });
            return { status: "success", message: "Admin login successful", token: session.token, expiresIn: session.expiresIn, mfaEnrollmentCompleted: challenge.purpose === "enroll" };
        }
        finally {
            client.release();
        }
    }
    async logout(req) {
        const authHeader = req.headers.authorization;
        const token = authHeader.substring(7);
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("DELETE FROM user_sessions WHERE session_token = $1", [token]);
        }
        finally {
            client.release();
        }
        return { status: "success", message: "Admin logged out" };
    }
    async session(req) {
        return { status: "success", admin: { id: req.adminSession?.userId || null, username: req.adminSession?.username || null }, expiresAt: req.adminSession?.expiresAt || null };
    }
    async sensitiveUnlock(req, res) {
        const password = String(req.body?.password || "").trim();
        if (!password)
            throw new common_1.BadRequestException({ error: "Password is required" });
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query("SELECT password_hash FROM accounts WHERE id = $1 AND role = 'admin'", [req.adminSession.userId]);
            const admin = result.rows[0];
            if (!admin || !(await passwords.verifyPassword(password, admin.password_hash)))
                throw new common_1.UnauthorizedException({ error: "Invalid password" });
            const token = this.signSensitiveViewToken(this.buildSensitiveViewTokenPayload(req.adminSession));
            if (!token)
                throw new common_1.HttpException({ error: "Unable to enable sensitive mode" }, 500);
            this.setSensitiveViewCookie(res, token);
            return { status: "success", sensitiveViewEnabled: true, expiresIn: Math.floor(ADMIN_SENSITIVE_VIEW_TIMEOUT_MS / 1000) };
        }
        finally {
            client.release();
        }
    }
    async sensitiveLock(req, res) {
        this.clearSensitiveViewCookie(res);
        return { status: "success", sensitiveViewEnabled: false };
    }
    async assertPublicTable(client, table, includeSensitive = false) {
        if (!includeSensitive && this.isRestrictedAdminTable(table))
            return false;
        const result = await client.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS exists`, [table]);
        return Boolean(result.rows[0]?.exists);
    }
    async getTableColumns(client, table) {
        const result = await client.query(`SELECT c.column_name AS name, c.data_type AS type, c.is_nullable AS nullable, c.column_default AS default_value, c.character_maximum_length AS max_length, CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END AS key_type, CASE WHEN c.column_default LIKE 'nextval%' OR c.is_identity = 'YES' THEN true ELSE false END AS is_auto_increment FROM information_schema.columns c LEFT JOIN (SELECT ku.column_name, ku.table_name, ku.table_schema FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema WHERE tc.constraint_type = 'PRIMARY KEY') pk ON pk.column_name = c.column_name AND pk.table_name = c.table_name AND pk.table_schema = c.table_schema WHERE c.table_schema = 'public' AND c.table_name = $1 ORDER BY c.ordinal_position`, [table]);
        return result.rows.map((column) => ({ name: column.name, type: column.type, nullable: column.nullable === "YES", isPrimary: column.key_type === "PRI", isAutoIncrement: column.is_auto_increment, defaultValue: column.default_value, maxLength: column.max_length ? Number(column.max_length) : null }));
    }
    async getPrimaryKey(client, table) {
        const result = await client.query(`SELECT ku.column_name AS name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = 'public' ORDER BY ku.ordinal_position`, [table]);
        return result.rows[0]?.name || "id";
    }
    sanitizeRowData(data, columns, includeSensitive = false) {
        const editableColumns = new Map(columns.filter((column) => !column.isAutoIncrement).filter((column) => includeSensitive || !this.isSensitiveAdminColumn(column.name)).map((column) => [column.name, column]));
        const sanitized = {};
        for (const [key, value] of Object.entries(data || {})) {
            if (editableColumns.has(key) && (includeSensitive || !this.isSensitiveAdminColumn(key)))
                sanitized[key] = value;
        }
        delete sanitized.created_at;
        delete sanitized.updated_at;
        return sanitized;
    }
    async getTables(req) {
        const includeSensitive = Boolean(req.adminSensitiveView);
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const metaResult = await client.query(`SELECT relname as name, obj_description(c.oid, 'pg_class') as comment FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY relname`);
            if (metaResult.rows.length === 0)
                return { status: "success", tables: [] };
            const visibleTables = includeSensitive ? metaResult.rows : metaResult.rows.filter((t) => !this.isRestrictedAdminTable(t.name));
            if (visibleTables.length === 0)
                return { status: "success", tables: [] };
            const countQuery = visibleTables.map((t) => `SELECT '${t.name}' as name, COUNT(*)::bigint as row_count FROM "${t.name}"`).join(" UNION ALL ");
            const countResult = await client.query(countQuery);
            const countMap = {};
            for (const row of countResult.rows)
                countMap[row.name] = Number(row.row_count);
            return { status: "success", tables: visibleTables.map((t) => ({ name: t.name, rowCount: countMap[t.name] ?? 0, comment: t.comment || "" })) };
        }
        finally {
            client.release();
        }
    }
    async getTableInfo(req) {
        const { table } = req.params;
        if (!this.isSafeSqlIdentifier(table))
            throw new common_1.BadRequestException({ error: "Invalid table name" });
        const includeSensitive = Boolean(req.adminSensitiveView);
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const tableExists = await this.assertPublicTable(client, table, includeSensitive);
            if (!tableExists)
                throw new common_1.NotFoundException({ error: "Table not found" });
            const columnsResult = await client.query(`SELECT c.column_name as name, c.data_type as type, c.is_nullable as nullable, c.column_default as default_value, c.character_maximum_length as max_length, pg_catalog.col_description(t.oid, c.ordinal_position) as comment, CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END as key_type, CASE WHEN c.column_default LIKE 'nextval%' OR c.is_identity = 'YES' THEN true ELSE false END as is_auto_increment FROM information_schema.columns c JOIN pg_class t ON t.relname = c.table_name JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema LEFT JOIN (SELECT ku.column_name, ku.table_name, ku.table_schema FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema WHERE tc.constraint_type = 'PRIMARY KEY') pk ON pk.column_name = c.column_name AND pk.table_name = c.table_name AND pk.table_schema = c.table_schema WHERE c.table_schema = 'public' AND c.table_name = $1 ORDER BY c.ordinal_position`, [table]);
            const pkResult = await client.query(`SELECT ku.column_name as name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = 'public'`, [table]);
            const primaryKey = pkResult.rows.length > 0 ? pkResult.rows[0].name : "id";
            const visibleColumns = includeSensitive ? columnsResult.rows : columnsResult.rows.filter((column) => !this.isSensitiveAdminColumn(column.name));
            return { status: "success", table, primaryKey, columns: visibleColumns.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable === "YES", isPrimary: c.key_type === "PRI", isAutoIncrement: c.is_auto_increment, defaultValue: c.default_value, maxLength: c.max_length ? Number(c.max_length) : null, comment: c.comment || "" })) };
        }
        finally {
            client.release();
        }
    }
    async getTableData(req) {
        const { table } = req.params;
        if (!this.isSafeSqlIdentifier(table))
            throw new common_1.BadRequestException({ error: "Invalid table name" });
        const includeSensitive = Boolean(req.adminSensitiveView);
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = (page - 1) * limit;
        const requestedSortBy = req.query.sortBy || "id";
        if (!this.isSafeSqlIdentifier(requestedSortBy))
            throw new common_1.BadRequestException({ error: "Invalid sort column" });
        const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
        const search = req.query.search || "";
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const tableExists = await this.assertPublicTable(client, table, includeSensitive);
            if (!tableExists)
                throw new common_1.NotFoundException({ error: "Table not found" });
            const tableColumns = await this.getTableColumns(client, table);
            const visibleColumns = includeSensitive ? tableColumns : this.getVisibleAdminColumns(tableColumns);
            if (visibleColumns.length === 0)
                throw new common_1.NotFoundException({ error: "Table not found" });
            const columnNames = new Set(visibleColumns.map((column) => column.name));
            const sortBy = columnNames.has(requestedSortBy) ? requestedSortBy : await this.getPrimaryKey(client, table);
            let countQuery = `SELECT COUNT(*) as total FROM "${table}"`;
            let dataQuery = `SELECT ${visibleColumns.map((c) => `"${c.name}"`).join(", ")} FROM "${table}"`;
            const params = [];
            let paramIdx = 1;
            if (search) {
                const columnsResult = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND data_type IN ('character varying', 'text', 'character', 'jsonb')`, [table]);
                if (columnsResult.rows.length > 0) {
                    const searchableColumns = includeSensitive ? columnsResult.rows : columnsResult.rows.filter((c) => columnNames.has(c.column_name));
                    const searchConditions = searchableColumns.map((c) => `"${c.column_name}"::text ILIKE $${paramIdx++}`).join(" OR ");
                    if (searchConditions) {
                        countQuery += ` WHERE (${searchConditions})`;
                        dataQuery += ` WHERE (${searchConditions})`;
                        searchableColumns.forEach(() => params.push(`%${search}%`));
                    }
                }
            }
            const countResult = await client.query(countQuery, params);
            const total = Number(countResult.rows[0].total);
            dataQuery += ` ORDER BY "${sortBy}" ${sortOrder} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
            params.push(limit, offset);
            const result = await client.query(dataQuery, params);
            return { status: "success", table, data: result.rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
        }
        finally {
            client.release();
        }
    }
    async insertRow(req) {
        const { table } = req.params;
        if (!this.isSafeSqlIdentifier(table))
            throw new common_1.BadRequestException({ error: "Invalid table name" });
        const includeSensitive = Boolean(req.adminSensitiveView);
        const data = req.body;
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const tableExists = await this.assertPublicTable(client, table, includeSensitive);
            if (!tableExists)
                throw new common_1.NotFoundException({ error: "Table not found" });
            const tableColumns = await this.getTableColumns(client, table);
            const sanitized = this.sanitizeRowData(data, tableColumns, includeSensitive);
            if (!sanitized || Object.keys(sanitized).length === 0)
                throw new common_1.BadRequestException({ error: "No editable data provided" });
            if (table === "accounts" && sanitized.password_hash)
                sanitized.password_hash = await passwords.hashPassword(sanitized.password_hash);
            const primaryKey = await this.getPrimaryKey(client, table);
            const columns = Object.keys(sanitized);
            const values = Object.values(sanitized);
            const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
            const result = await client.query(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders}) RETURNING "${primaryKey}"`, values);
            return { status: "success", message: "Row inserted successfully", insertId: result.rows[0]?.[primaryKey] ?? null };
        }
        finally {
            client.release();
        }
    }
    async updateRow(req) {
        const { table, id } = req.params;
        if (!this.isSafeSqlIdentifier(table))
            throw new common_1.BadRequestException({ error: "Invalid table name" });
        const includeSensitive = Boolean(req.adminSensitiveView);
        const data = req.body;
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const tableExists = await this.assertPublicTable(client, table, includeSensitive);
            if (!tableExists)
                throw new common_1.NotFoundException({ error: "Table not found" });
            const tableColumns = await this.getTableColumns(client, table);
            const sanitized = this.sanitizeRowData(data, tableColumns, includeSensitive);
            if (!sanitized || Object.keys(sanitized).length === 0)
                throw new common_1.BadRequestException({ error: "No editable data provided" });
            if (table === "accounts" && sanitized.password_hash) {
                const result = await client.query("SELECT password_hash FROM accounts WHERE id = $1", [id]);
                const currentUser = result.rows[0];
                if (currentUser && currentUser.password_hash === sanitized.password_hash)
                    delete sanitized.password_hash;
                else
                    sanitized.password_hash = await passwords.hashPassword(sanitized.password_hash);
            }
            const primaryKey = await this.getPrimaryKey(client, table);
            const columns = Object.keys(sanitized);
            const values = Object.values(sanitized);
            const setClause = columns.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
            const result = await client.query(`UPDATE "${table}" SET ${setClause} WHERE "${primaryKey}" = $${columns.length + 1}`, [...values, id]);
            if (result.rowCount === 0)
                throw new common_1.NotFoundException({ error: "Row not found" });
            return { status: "success", message: "Row updated successfully", affectedRows: Number(result.rowCount) };
        }
        finally {
            client.release();
        }
    }
    async deleteRow(req) {
        const { table, id } = req.params;
        if (!this.isSafeSqlIdentifier(table))
            throw new common_1.BadRequestException({ error: "Invalid table name" });
        const includeSensitive = Boolean(req.adminSensitiveView);
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const tableExists = await this.assertPublicTable(client, table, includeSensitive);
            if (!tableExists)
                throw new common_1.NotFoundException({ error: "Table not found" });
            const primaryKey = await this.getPrimaryKey(client, table);
            const result = await client.query(`DELETE FROM "${table}" WHERE "${primaryKey}" = $1`, [id]);
            if (result.rowCount === 0)
                throw new common_1.NotFoundException({ error: "Row not found" });
            return { status: "success", message: "Row deleted successfully", affectedRows: Number(result.rowCount) };
        }
        finally {
            client.release();
        }
    }
    async executeQuery(req) {
        const { sql } = req.body;
        if (!sql)
            throw new common_1.BadRequestException({ error: "SQL query is required" });
        if (!this.isSafeReadOnlyAdminQuery(sql))
            throw new common_1.ForbiddenException({ error: "Only single-statement read-only queries are allowed (SELECT/WITH/SHOW/DESCRIBE)." });
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(`SET LOCAL statement_timeout = ${ADMIN_QUERY_TIMEOUT_MS}`);
            await client.query("SET TRANSACTION READ ONLY");
            const result = await client.query(sql);
            await client.query("ROLLBACK");
            return { status: "success", data: result.rows, rowCount: result.rowCount };
        }
        catch (queryError) {
            await client.query("ROLLBACK");
            throw queryError;
        }
        finally {
            client.release();
        }
    }
    async getTelemetry(req) {
        const rawWindowHours = Number.parseInt(String(req.query.windowHours || "24"), 10);
        const windowHours = Number.isFinite(rawWindowHours) ? Math.min(Math.max(rawWindowHours, 1), 24 * 30) : 24;
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const summaryResult = await client.query(`SELECT COUNT(*) FILTER (WHERE event_type = 'login_failed') AS failed_logins, COUNT(*) FILTER (WHERE event_type = 'login_locked') AS lock_events, COUNT(*) FILTER (WHERE event_type = 'login_success') AS successful_logins, COUNT(DISTINCT ip_address) FILTER (WHERE event_type IN ('login_failed', 'login_locked')) AS distinct_source_ips FROM auth_security_events WHERE created_at >= NOW() - (($1)::text || ' hours')::interval`, [windowHours]);
            const lockedAccountsResult = await client.query(`SELECT login_key, failed_attempts, lock_until, last_failed_at FROM auth_login_attempts WHERE lock_until IS NOT NULL AND lock_until > NOW() ORDER BY lock_until DESC LIMIT 200`);
            const topSourcesResult = await client.query(`SELECT ip_address, COUNT(*)::int AS attempts FROM auth_security_events WHERE created_at >= NOW() - (($1)::text || ' hours')::interval AND event_type IN ('login_failed', 'login_locked') AND ip_address IS NOT NULL GROUP BY ip_address ORDER BY attempts DESC LIMIT 20`, [windowHours]);
            const summary = summaryResult.rows[0] || {};
            return { status: "success", windowHours, summary: { failedLogins: Number(summary.failed_logins || 0), lockEvents: Number(summary.lock_events || 0), successfulLogins: Number(summary.successful_logins || 0), distinctSourceIps: Number(summary.distinct_source_ips || 0) }, lockedLoginKeys: lockedAccountsResult.rows, topSources: topSourcesResult.rows };
        }
        finally {
            client.release();
        }
    }
    async getSecurityEvents(req) {
        const rawLimit = Number.parseInt(String(req.query.limit || "200"), 10);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 200;
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const eventsResult = await client.query(`SELECT id, event_type, login_key, account_id, ip_address, user_agent, details, created_at FROM auth_security_events ORDER BY created_at DESC LIMIT $1`, [limit]);
            return { status: "success", count: eventsResult.rows.length, events: eventsResult.rows };
        }
        finally {
            client.release();
        }
    }
    async clearLockout(req) {
        const loginKey = String(req.params.loginKey || "").trim().toLowerCase().slice(0, 254);
        if (!loginKey)
            throw new common_1.BadRequestException({ error: "loginKey is required" });
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query("DELETE FROM auth_login_attempts WHERE login_key = $1", [loginKey]);
            await client.query(`INSERT INTO auth_security_events (event_type, login_key, account_id, ip_address, user_agent, details) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, ["lockout_cleared_admin", loginKey, req.adminSession?.userId || null, null, null, JSON.stringify({ clearedBy: req.adminSession?.username || "unknown" })]);
            return { status: "success", removed: Number(result.rowCount || 0) };
        }
        finally {
            client.release();
        }
    }
};
exports.AdminService = AdminService;
exports.AdminService = AdminService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], AdminService);
