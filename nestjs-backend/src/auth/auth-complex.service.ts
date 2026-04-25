import { Injectable, Logger, HttpException, BadRequestException, NotFoundException, ConflictException, UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as crypto from "crypto";
import type { Request, Response } from "express";
import * as passwords from "../common/utils/passwords";
import * as encryption from "../common/utils/encryption";
import * as mailer from "../common/utils/resendMailer";
import * as authTokens from "../common/utils/auth-tokens";

const QRCode: any = require("qrcode");

const IS_NON_PROD = process.env.NODE_ENV !== "production";
const RELAX_AUTH_LIMITS_IN_DEV = IS_NON_PROD && process.env.ENABLE_STRICT_AUTH_LIMITS !== "true" && process.env.DISABLE_RATE_LIMIT !== "false";
const AUTH_LOCK_THRESHOLD = Math.max(8, Number.parseInt(process.env.AUTH_LOCK_THRESHOLD || "10", 10));
const AUTH_FAILURE_WINDOW_MINUTES = Math.max(1, Number.parseInt(process.env.AUTH_FAILURE_WINDOW_MINUTES || "20", 10));
const AUTH_LOCK_BASE_SECONDS = Math.max(5, Number.parseInt(process.env.AUTH_LOCK_BASE_SECONDS || "30", 10));
const AUTH_LOCK_MAX_SECONDS = Math.max(AUTH_LOCK_BASE_SECONDS, Number.parseInt(process.env.AUTH_LOCK_MAX_SECONDS || "900", 10));
const USER_MFA_ISSUER = String(process.env.USER_MFA_ISSUER || "Filspresso").slice(0, 64);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || process.env.NEXT_PUBLIC_FRONTEND_URL || String(process.env.CORS_ORIGIN || "http://localhost:3000").split(",")[0].trim() || "http://localhost:3000";
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || "";
const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || "http://localhost:4000";
const EMAIL_VERIFICATION_TOKEN_TTL_SECONDS = Math.max(300, Number.parseInt(process.env.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS || "86400", 10));
const USER_MFA_CODE_DIGITS = 6;
const USER_MFA_TIME_STEP_SECONDS = Math.max(15, Number.parseInt(process.env.USER_MFA_TIME_STEP_SECONDS || "30", 10));
const USER_MFA_ALLOWED_DRIFT_STEPS = Math.max(0, Number.parseInt(process.env.USER_MFA_ALLOWED_DRIFT_STEPS || "1", 10));
const USER_MFA_VERIFY_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.USER_MFA_VERIFY_TTL_SECONDS || "300", 10));
const USER_MFA_SETUP_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.USER_MFA_SETUP_TTL_SECONDS || "600", 10));

@Injectable()
export class AuthComplexService {
  private readonly logger = new Logger(AuthComplexService.name);
  constructor(private readonly db: DatabaseService) {}

  private normalizeCredentialField(value: any, maxLength: number) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLength);
  }

  private isReasonablePassword(password: any) {
    return typeof password === "string" && password.length >= 8 && password.length <= 128;
  }

  private getClientIp(req: Request) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const realIp = String(req.headers["x-real-ip"] || "").trim();
    const candidate = forwarded || realIp || req.ip || req.socket?.remoteAddress || "";
    return String(candidate).slice(0, 64) || null;
  }

  private normalizeLoginKey(loginField: string) {
    return this.normalizeCredentialField(loginField, 254).toLowerCase();
  }

  private computeLoginAttemptKey(loginKey: string, ipAddress: string | null) {
    const normalizedLoginKey = this.normalizeLoginKey(loginKey);
    const normalizedIp = (typeof ipAddress === "string" ? ipAddress.trim() : "") || "unknown";
    return crypto.createHash("sha256").update(`${normalizedLoginKey}|${normalizedIp}`).digest("hex");
  }

  private computeLockSeconds(failedAttempts: number) {
    if (failedAttempts < AUTH_LOCK_THRESHOLD) return 0;
    const exponent = Math.max(0, failedAttempts - AUTH_LOCK_THRESHOLD);
    const calculated = AUTH_LOCK_BASE_SECONDS * 2 ** exponent;
    return Math.min(calculated, AUTH_LOCK_MAX_SECONDS);
  }

  private async getLockState(client: any, loginKey: string) {
    if (RELAX_AUTH_LIMITS_IN_DEV) return { isLocked: false, retryAfterSeconds: 0, failedAttempts: 0 };
    const result = await client.query(`SELECT failed_attempts, lock_until FROM auth_login_attempts WHERE login_key = $1 LIMIT 1`, [loginKey]);
    const row = result.rows[0];
    if (!row) return { isLocked: false, retryAfterSeconds: 0, failedAttempts: 0 };
    const lockUntil = row.lock_until ? new Date(row.lock_until) : null;
    if (!lockUntil || Number.isNaN(lockUntil.getTime()) || lockUntil <= new Date()) {
      return { isLocked: false, retryAfterSeconds: 0, failedAttempts: Number(row.failed_attempts) || 0 };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((lockUntil.getTime() - Date.now()) / 1000));
    return { isLocked: true, retryAfterSeconds, failedAttempts: Number(row.failed_attempts) || 0 };
  }

  private async recordFailedAttempt(client: any, loginKey: string) {
    const result = await client.query(
      `INSERT INTO auth_login_attempts (login_key, failed_attempts, first_failed_at, last_failed_at, lock_until, updated_at)
       VALUES ($1, 1, NOW(), NOW(), NULL, NOW())
       ON CONFLICT (login_key) DO UPDATE
       SET failed_attempts = CASE
          WHEN auth_login_attempts.last_failed_at IS NULL OR auth_login_attempts.last_failed_at < NOW() - (($2)::text || ' minutes')::interval THEN 1
          ELSE auth_login_attempts.failed_attempts + 1 END,
         first_failed_at = CASE
          WHEN auth_login_attempts.last_failed_at IS NULL OR auth_login_attempts.last_failed_at < NOW() - (($2)::text || ' minutes')::interval THEN NOW()
          ELSE auth_login_attempts.first_failed_at END,
         last_failed_at = NOW(), updated_at = NOW()
       RETURNING failed_attempts`,
      [loginKey, AUTH_FAILURE_WINDOW_MINUTES],
    );
    const failedAttempts = Number(result.rows[0]?.failed_attempts) || 1;
    const lockSeconds = this.computeLockSeconds(failedAttempts);
    if (lockSeconds > 0) {
      await client.query("UPDATE auth_login_attempts SET lock_until = NOW() + (($1)::text || ' seconds')::interval WHERE login_key = $2", [lockSeconds, loginKey]);
    }
    return { failedAttempts, lockSeconds };
  }

  private async clearFailedAttempts(client: any, loginKey: string) {
    await client.query("DELETE FROM auth_login_attempts WHERE login_key = $1", [loginKey]);
  }

  private async logAuthSecurityEvent(client: any, eventType: string, payload: any = {}) {
    const loginKey = payload.loginKey ? String(payload.loginKey).slice(0, 254) : null;
    const accountId = Number.isInteger(payload.accountId) ? payload.accountId : null;
    const ipAddress = payload.ipAddress ? String(payload.ipAddress).slice(0, 64) : null;
    const userAgent = payload.userAgent ? String(payload.userAgent).slice(0, 512) : null;
    const details = payload.details && typeof payload.details === "object" ? payload.details : {};
    await client.query(
      `INSERT INTO auth_security_events (event_type, login_key, account_id, ip_address, user_agent, details) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [eventType, loginKey, accountId, ipAddress, userAgent, JSON.stringify(details)],
    );
  }

  private hashMfaChallengeToken(token: string) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
  }

  private generateMfaBase32Secret(length = 32) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bytes = crypto.randomBytes(length);
    let output = "";
    for (let i = 0; i < bytes.length; i += 1) output += alphabet[bytes[i] % alphabet.length];
    return output;
  }

  private decodeMfaBase32(base32: string) {
    const clean = String(base32 || "").toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const char of clean) {
      const value = alphabet.indexOf(char);
      if (value < 0) continue;
      bits += value.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
  }

  private generateTotpCode(secret: string, timestampMs = Date.now()) {
    const key = this.decodeMfaBase32(secret);
    if (!key.length) return null;
    const counter = Math.floor(timestampMs / 1000 / USER_MFA_TIME_STEP_SECONDS);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    counterBuffer.writeUInt32BE(counter >>> 0, 4);
    const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    return String(binary % 10 ** USER_MFA_CODE_DIGITS).padStart(USER_MFA_CODE_DIGITS, "0");
  }

  private verifyTotpCode(secret: string, submittedCode: string) {
    const normalizedCode = String(submittedCode || "").trim().replace(/\s+/g, "");
    if (!/^\d{6,8}$/.test(normalizedCode)) return false;
    for (let drift = -USER_MFA_ALLOWED_DRIFT_STEPS; drift <= USER_MFA_ALLOWED_DRIFT_STEPS; drift += 1) {
      const timestamp = Date.now() + drift * USER_MFA_TIME_STEP_SECONDS * 1000;
      const code = this.generateTotpCode(secret, timestamp);
      if (code && code === normalizedCode) return true;
    }
    return false;
  }

  private buildUserOtpAuthUrl(secret: string, username: string) {
    const accountName = encodeURIComponent(String(username || "user").trim().toLowerCase());
    const issuer = encodeURIComponent(USER_MFA_ISSUER);
    return `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${USER_MFA_CODE_DIGITS}&period=${USER_MFA_TIME_STEP_SECONDS}`;
  }

  private async generateMfaQrDataUrl(otpauthUrl: string) {
    try {
      return await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: "M", margin: 1, width: 220 });
    } catch {
      return null;
    }
  }

  private async buildMfaSetupPayload(opts: any) {
    const otpauthUrl = this.buildUserOtpAuthUrl(opts.secret, opts.username);
    const payload: any = { secret: opts.secret, issuer: USER_MFA_ISSUER, accountName: opts.username, otpauthUrl };
    if (opts.includeQrCode) payload.qrDataUrl = await this.generateMfaQrDataUrl(otpauthUrl);
    return payload;
  }

  private async createUserMfaChallenge(client: any, opts: any) {
    const token = `mfa_${crypto.randomBytes(48).toString("hex")}`;
    const tokenHash = this.hashMfaChallengeToken(token);
    const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000);
    await client.query(
      `INSERT INTO user_mfa_challenges (account_id, challenge_token_hash, purpose, temp_secret_encrypted, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [opts.accountId, tokenHash, opts.purpose, opts.tempSecretEncrypted, expiresAt],
    );
    return { token, expiresIn: opts.ttlSeconds };
  }

  private async getActiveUserMfaChallenge(client: any, token: string) {
    const tokenHash = this.hashMfaChallengeToken(token);
    const result = await client.query(
      `SELECT c.id, c.account_id, c.purpose, c.temp_secret_encrypted, c.attempts, c.max_attempts, c.expires_at,
          a.username, a.email, a.name, a.icon, a.role, a.created_at, a.subscription, a.user_mfa_enabled, a.user_mfa_secret_encrypted
       FROM user_mfa_challenges c JOIN accounts a ON a.id = c.account_id WHERE c.challenge_token_hash = $1 AND c.consumed_at IS NULL LIMIT 1`,
      [tokenHash],
    );
    return result.rows[0] || null;
  }

  private async invalidateExpiredUserMfaChallenges(client: any) {
    await client.query("DELETE FROM user_mfa_challenges WHERE consumed_at IS NOT NULL OR expires_at < NOW()");
  }

  private formatUserIcon(icon: string) {
    let iconUrl = icon || null;
    if (iconUrl && !iconUrl.startsWith("/") && !iconUrl.startsWith("http") && !iconUrl.startsWith("data:")) iconUrl = `/images/icons/${iconUrl}`;
    if (iconUrl && iconUrl.startsWith("/images/icons/") && !/\.(svg|png|jpe?g|ico|webp|avif)(\?.*)?$/i.test(iconUrl)) iconUrl = `${iconUrl}.svg`;
    return iconUrl;
  }

  private buildAuthAccountPayload(user: any) {
    return { name: user.name, full_name: user.name, username: user.username, email: user.email, role: user.role, icon: this.formatUserIcon(user.icon), created_at: user.created_at };
  }

  private safeReturnTo(value: string) {
    if (typeof value !== "string") return "/?page=account";
    const trimmed = value.trim();
    if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\n") || trimmed.includes("\r")) return "/?page=account";
    return trimmed;
  }

  private createOAuthState(provider: string, mode: string, returnTo: string) {
    const payload = { provider, mode, returnTo: this.safeReturnTo(returnTo), timestamp: Date.now(), nonce: crypto.randomBytes(12).toString("hex") };
    const serialized = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = crypto.createHmac("sha256", authTokens.JWT_SECRET).update(serialized).digest("base64url");
    return `${serialized}.${signature}`;
  }

  private verifyOAuthState(state: string, expectedProvider: string) {
    if (typeof state !== "string" || !state.includes(".")) return null;
    const [serialized, signature] = state.split(".");
    if (!serialized || !signature) return null;
    const expectedSignature = crypto.createHmac("sha256", authTokens.JWT_SECRET).update(serialized).digest("base64url");
    if (signature !== expectedSignature) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(serialized, "base64url").toString("utf8")); } catch { return null; }
    if (!payload || payload.provider !== expectedProvider) return null;
    const ageMs = Date.now() - Number(payload.timestamp || 0);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10 * 60 * 1000) return null;
    return { mode: payload.mode === "signup" ? "signup" : "login", returnTo: this.safeReturnTo(payload.returnTo) };
  }

  private buildOAuthConfig(provider: string) {
    if (provider === "google") {
      if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI) return null;
      return { provider, clientId: GOOGLE_OAUTH_CLIENT_ID, clientSecret: GOOGLE_OAUTH_CLIENT_SECRET, redirectUri: GOOGLE_OAUTH_REDIRECT_URI };
    }
    return null;
  }

  private createEmailVerificationToken(opts: any) {
    const payload = { aid: Number(opts.accountId), email: this.normalizeCredentialField(opts.email, 254).toLowerCase(), exp: Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_SECONDS * 1000, nonce: crypto.randomBytes(12).toString("hex") };
    const serialized = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = crypto.createHmac("sha256", authTokens.JWT_SECRET).update(serialized).digest("base64url");
    return `${serialized}.${signature}`;
  }

  private verifyEmailVerificationToken(token: string) {
    if (typeof token !== "string" || !token.includes(".")) return null;
    const [serialized, signature] = token.split(".");
    if (!serialized || !signature) return null;
    const expectedSignature = crypto.createHmac("sha256", authTokens.JWT_SECRET).update(serialized).digest("base64url");
    if (expectedSignature !== signature) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(serialized, "base64url").toString("utf8")); } catch { return null; }
    if (!payload || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    const accountId = Number.parseInt(String(payload.aid || ""), 10);
    const email = this.normalizeCredentialField(payload.email, 254).toLowerCase();
    if (!Number.isInteger(accountId) || accountId <= 0 || !email) return null;
    return { accountId, email };
  }

  private normalizeOAuthProfileName(profile: any, fallbackEmail: string) {
    const candidate = profile.name || profile.given_name || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || (fallbackEmail ? String(fallbackEmail).split("@")[0] : "");
    return this.normalizeCredentialField(candidate || "Filspresso User", 120) || "Filspresso User";
  }

  private async createUniqueUsername(client: any, preferredBase: string) {
    const normalizedBase = this.normalizeCredentialField(preferredBase, 40).toLowerCase().replace(/[^a-z0-9._-]/g, "") || `user${crypto.randomBytes(3).toString("hex")}`;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const suffix = attempt === 0 ? "" : `_${crypto.randomBytes(2).toString("hex")}`;
      const candidate = `${normalizedBase}${suffix}`.slice(0, 50);
      const existing = await client.query("SELECT id FROM accounts WHERE username = $1 LIMIT 1", [candidate]);
      if (!existing.rows[0]) return candidate;
    }
    return `user_${crypto.randomBytes(5).toString("hex")}`;
  }

  private buildOAuthSuccessRedirect(returnTo: string, account: any, token: string) {
    const url = new URL(returnTo, FRONTEND_ORIGIN);
    const payload = Buffer.from(JSON.stringify({ account: this.buildAuthAccountPayload(account), token }), "utf8").toString("base64url");
    url.searchParams.set("oauth", payload);
    return url.toString();
  }

  private buildOAuthFailureRedirect(returnTo: string, errorCode: string) {
    const url = new URL(returnTo, FRONTEND_ORIGIN);
    url.searchParams.set("oauth_error", errorCode || "oauth_failed");
    return url.toString();
  }

  private async findOrCreateOAuthAccount(client: any, opts: any) {
    const normalizedEmail = this.normalizeCredentialField(opts.email, 254).toLowerCase();
    const normalizedSubject = this.normalizeCredentialField(opts.subject, 191);
    if (!normalizedEmail || !normalizedSubject) return null;

    let existing = await client.query(`SELECT id, username, email, name, icon, role, created_at FROM accounts WHERE google_sub = $1 LIMIT 1`, [normalizedSubject]);
    if (existing.rows[0]) return { ...existing.rows[0], isNewAccount: false };

    existing = await client.query("SELECT id, username, email, name, icon, role, created_at FROM accounts WHERE email = $1 LIMIT 1", [normalizedEmail]);
    if (existing.rows[0]) {
      const current = existing.rows[0];
      await client.query(
        `UPDATE accounts SET google_sub = $1, oauth_provider = COALESCE(oauth_provider, $2), oauth_subject = COALESCE(oauth_subject, $3), oauth_linked_at = COALESCE(oauth_linked_at, NOW()), icon = COALESCE(NULLIF(icon, ''), $4), name = CASE WHEN COALESCE(name, '') = '' THEN $5 ELSE name END, updated_at = NOW() WHERE id = $6`,
        [normalizedSubject, opts.provider, normalizedSubject, opts.pictureUrl || null, opts.displayName, current.id],
      );
      return { ...current, name: current.name || opts.displayName, icon: current.icon || opts.pictureUrl || null, isNewAccount: false };
    }

    const usernameBase = normalizedEmail.split("@")[0] || `user_${opts.provider}`;
    const username = await this.createUniqueUsername(client, usernameBase);
    const randomPasswordHash = await passwords.hashPassword(crypto.randomBytes(32).toString("hex"));
    const created = await client.query(
      `INSERT INTO accounts (username, email, password_hash, name, icon, oauth_provider, oauth_subject, oauth_linked_at, google_sub, email_verified) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, TRUE) RETURNING id, username, email, name, icon, role, created_at`,
      [username, normalizedEmail, randomPasswordHash, opts.displayName, opts.pictureUrl || null, opts.provider, normalizedSubject, normalizedSubject],
    );
    if (!created.rows[0]) return null;
    return { ...created.rows[0], isNewAccount: true };
  }

  // ENDPOINTS

  async register(req: Request) {
    const username = this.normalizeCredentialField(req.body?.username, 64);
    const email = this.normalizeCredentialField(req.body?.email, 254);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const full_name = this.normalizeCredentialField(req.body?.full_name, 120);
    const name = this.normalizeCredentialField(req.body?.name, 120);
    const icon = typeof req.body?.icon === "string" ? req.body.icon.trim().slice(0, 255) : null;
    const enable2fa = Boolean(req.body?.enable2fa);
    const includeQrCode = Boolean(req.body?.includeQrCode);
    const displayName = full_name || name;

    if (!username || !email || !password) throw new BadRequestException({ error: "Username, email, and password are required" });
    if (!this.isReasonablePassword(password)) throw new BadRequestException({ error: "Password must be 8-128 characters" });

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const existing = await client.query("SELECT id FROM accounts WHERE email = $1 OR username = $2", [email.toLowerCase(), username.toLowerCase()]);
      if (existing.rows.length > 0) throw new ConflictException({ error: "User with this email or username already exists" });

      const passwordHash = await passwords.hashPassword(password);
      const result = await client.query(
        `INSERT INTO accounts (username, email, password_hash, name, icon, email_verified) VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id`,
        [username.toLowerCase(), email.toLowerCase(), passwordHash, displayName || username, icon || null],
      );

      const userId = result.rows[0].id;
      const userRes = await client.query("SELECT id, username, email, name, icon, role, created_at FROM accounts WHERE id = $1", [userId]);
      const user = userRes.rows[0];

      const token = authTokens.generateToken(user);
      const expiresAt = authTokens.buildSessionExpiryDate();
      await client.query("INSERT INTO user_sessions (account_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)", [user.id, token, expiresAt, req.ip, req.get("user-agent")]);

      let mfaSetup = null;
      if (enable2fa) {
        const setupSecret = this.generateMfaBase32Secret(32);
        const challenge = await this.createUserMfaChallenge(client, { accountId: user.id, purpose: "enable", ttlSeconds: USER_MFA_SETUP_TTL_SECONDS, tempSecretEncrypted: encryption.encrypt(setupSecret) });
        mfaSetup = { challengeToken: challenge.token, expiresIn: challenge.expiresIn, totp: await this.buildMfaSetupPayload({ secret: setupSecret, username: user.username, includeQrCode }) };
        await this.logAuthSecurityEvent(client, "user_mfa_setup_started", { accountId: user.id, ipAddress: this.getClientIp(req), userAgent: String(req.get("user-agent") || "").slice(0, 512) });
      }

      mailer.sendTransactionalEmail({
        to: user.email, subject: "Verify your Filspresso email", text: `Verify your account.`, html: mailer.buildEmailVerificationHtml({ displayName: user.name || user.username, verificationUrl: `${BACKEND_PUBLIC_URL.replace(/\/$/, "")}/api/auth/verify-email?token=${encodeURIComponent(this.createEmailVerificationToken({ accountId: user.id, email: user.email }))}` }),
      }).catch(e => this.logger.warn(e));

      mailer.sendTransactionalEmail({
        to: user.email, subject: "Welcome to Filspresso", text: `Welcome to Filspresso, ${user.name || "there"}.`, html: mailer.buildWelcomeHtml({ displayName: user.name || user.username, accountUrl: `${FRONTEND_ORIGIN.replace(/\/$/, "")}/?page=account` }),
      }).catch(e => this.logger.warn(e));

      return { status: "success", message: "User registered successfully", account: this.buildAuthAccountPayload(user), icon_path: this.formatUserIcon(user.icon), token, mfaSetup };
    } finally { client.release(); }
  }

  async login(req: Request, res: Response) {
    const email = this.normalizeCredentialField(req.body?.email, 254);
    const username = this.normalizeCredentialField(req.body?.username, 64);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const loginField = email || username;
    const loginKey = this.normalizeLoginKey(loginField);
    const ipAddress = this.getClientIp(req);
    const loginAttemptKey = this.computeLoginAttemptKey(loginKey, ipAddress);
    const userAgent = String(req.get("user-agent") || "").slice(0, 512);
    const includeQrCode = Boolean(req.body?.includeQrCode);

    if (!loginField || !password) throw new BadRequestException({ error: "Email/username and password are required" });
    if (loginField.length > 254 || password.length > 128 || !loginKey) throw new BadRequestException({ error: "Invalid credentials format" });

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const lockState = await this.getLockState(client, loginAttemptKey);
      if (lockState.isLocked) {
        await this.logAuthSecurityEvent(client, "login_locked", { loginKey, ipAddress, userAgent, details: { retryAfterSeconds: lockState.retryAfterSeconds, failedAttempts: lockState.failedAttempts } });
        res.setHeader("Retry-After", String(lockState.retryAfterSeconds));
        throw new HttpException({ status: "error", message: "Too many failed login attempts. Try again later.", retryAfterSeconds: lockState.retryAfterSeconds }, 429);
      }

      const userRes = await client.query("SELECT id, username, email, password_hash, name, icon, subscription, role, created_at, user_mfa_enabled, user_mfa_secret_encrypted FROM accounts WHERE email = $1 OR username = $2", [loginKey, loginKey]);
      const user = userRes.rows[0];

      if (!user) {
        const failed = await this.recordFailedAttempt(client, loginAttemptKey);
        await this.logAuthSecurityEvent(client, "login_failed", { loginKey, ipAddress, userAgent, details: { failedAttempts: failed.failedAttempts, lockSeconds: failed.lockSeconds, reason: "unknown_user" } });
        throw new UnauthorizedException({ error: "Invalid credentials" });
      }

      const validPassword = await passwords.verifyPassword(password, user.password_hash);
      if (!validPassword) {
        const failed = await this.recordFailedAttempt(client, loginAttemptKey);
        await this.logAuthSecurityEvent(client, "login_failed", { loginKey, accountId: user.id, ipAddress, userAgent, details: { failedAttempts: failed.failedAttempts, lockSeconds: failed.lockSeconds, reason: "bad_password" } });
        throw new UnauthorizedException({ error: "Invalid credentials" });
      }

      if (passwords.needsPasswordRehash(user.password_hash)) {
        try {
          const upgradedPasswordHash = await passwords.hashPassword(password);
          await client.query("UPDATE accounts SET password_hash = $1, updated_at = NOW() WHERE id = $2", [upgradedPasswordHash, user.id]);
        } catch {}
      }

      await this.clearFailedAttempts(client, loginAttemptKey);
      if (user.email) await this.clearFailedAttempts(client, this.computeLoginAttemptKey(String(user.email).toLowerCase(), ipAddress));
      if (user.username) await this.clearFailedAttempts(client, this.computeLoginAttemptKey(String(user.username).toLowerCase(), ipAddress));
      await this.invalidateExpiredUserMfaChallenges(client);

      if (user.user_mfa_enabled && user.user_mfa_secret_encrypted) {
        const challenge = await this.createUserMfaChallenge(client, { accountId: user.id, purpose: "login", ttlSeconds: USER_MFA_VERIFY_TTL_SECONDS });
        await this.logAuthSecurityEvent(client, "login_mfa_challenge_created", { loginKey, accountId: user.id, ipAddress, userAgent });
        return { status: "mfa_required", requiresMfa: true, challengeToken: challenge.token, expiresIn: challenge.expiresIn, message: "MFA verification required" };
      }

      await client.query("UPDATE accounts SET last_login = NOW() WHERE id = $1", [user.id]);
      const token = authTokens.generateToken(user);
      const expiresAt = authTokens.buildSessionExpiryDate();
      await client.query("INSERT INTO user_sessions (account_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)", [user.id, token, expiresAt, req.ip, req.get("user-agent")]);
      await this.logAuthSecurityEvent(client, "login_success", { loginKey, accountId: user.id, ipAddress, userAgent, details: { mfaUsed: false, includeQrCode } });
      
      mailer.sendTransactionalEmail({
        to: user.email, subject: "Filspresso security alert: new login", text: `New login detected.`, html: mailer.buildSecurityLoginHtml({ displayName: user.name || user.username, ipAddress, userAgent, occurredAt: new Date().toISOString() }),
      }).catch(e => this.logger.warn(e));

      return { status: "success", message: "Login successful", account: this.buildAuthAccountPayload(user), token };
    } finally { client.release(); }
  }

  async loginMfaVerify(req: Request, res: Response) {
    const challengeToken = this.normalizeCredentialField(req.body?.challengeToken, 256);
    const code = this.normalizeCredentialField(req.body?.code, 16);
    const ipAddress = this.getClientIp(req);
    const userAgent = String(req.get("user-agent") || "").slice(0, 512);

    if (!challengeToken || !code) throw new BadRequestException({ error: "Challenge token and code are required" });

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await this.invalidateExpiredUserMfaChallenges(client);
      const challenge = await this.getActiveUserMfaChallenge(client, challengeToken);
      if (!challenge || challenge.purpose !== "login") throw new UnauthorizedException({ error: "Invalid or expired MFA challenge" });

      if (challenge.expires_at && new Date(challenge.expires_at).getTime() <= Date.now()) {
        await client.query("DELETE FROM user_mfa_challenges WHERE id = $1", [challenge.id]);
        throw new UnauthorizedException({ error: "MFA challenge expired" });
      }

      if (challenge.attempts >= challenge.max_attempts) {
        await client.query("DELETE FROM user_mfa_challenges WHERE id = $1", [challenge.id]);
        await this.logAuthSecurityEvent(client, "login_mfa_verify_blocked", { accountId: challenge.account_id, ipAddress, userAgent, details: { reason: "attempt_limit_reached" } });
        throw new HttpException({ error: "Too many invalid MFA attempts" }, 429);
      }

      const secret = challenge.user_mfa_secret_encrypted ? encryption.decrypt(challenge.user_mfa_secret_encrypted) : "";
      const codeValid = Boolean(secret) && this.verifyTotpCode(secret, code);

      if (!codeValid) {
        await client.query("UPDATE user_mfa_challenges SET attempts = attempts + 1, updated_at = NOW() WHERE id = $1", [challenge.id]);
        await this.logAuthSecurityEvent(client, "login_mfa_verify_failed", { accountId: challenge.account_id, ipAddress, userAgent });
        throw new UnauthorizedException({ error: "Invalid authenticator code" });
      }

      await client.query("DELETE FROM user_mfa_challenges WHERE id = $1", [challenge.id]);
      const user = { id: challenge.account_id, username: challenge.username, email: challenge.email, name: challenge.name, icon: challenge.icon, role: challenge.role, created_at: challenge.created_at };
      await client.query("UPDATE accounts SET last_login = NOW() WHERE id = $1", [user.id]);
      const token = authTokens.generateToken(user);
      const expiresAt = authTokens.buildSessionExpiryDate();
      await client.query("INSERT INTO user_sessions (account_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)", [user.id, token, expiresAt, req.ip, req.get("user-agent")]);
      await this.logAuthSecurityEvent(client, "login_success", { accountId: user.id, ipAddress, userAgent, details: { mfaUsed: true } });

      mailer.sendTransactionalEmail({
        to: user.email, subject: "Filspresso security alert: new login", text: `New login detected.`, html: mailer.buildSecurityLoginHtml({ displayName: user.name || user.username, ipAddress, userAgent, occurredAt: new Date().toISOString() }),
      }).catch(e => this.logger.warn(e));

      return { status: "success", message: "Login successful", account: this.buildAuthAccountPayload(user), token };
    } finally { client.release(); }
  }

  async refresh(req: Request, res: Response) {
    const authHeader = String(req.headers.authorization || "");
    const activeToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!activeToken) throw new UnauthorizedException({ error: "Authentication required" });

    const decoded = authTokens.verifyToken(activeToken);
    if (!decoded || !Number.isInteger(decoded.id)) throw new UnauthorizedException({ error: "Invalid or expired token" });

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const sessionRes = await client.query(`SELECT a.id, a.username, a.email, a.name, a.icon, a.subscription, a.role, a.created_at FROM accounts a JOIN user_sessions s ON s.account_id = a.id WHERE s.session_token = $1 AND s.expires_at > NOW() LIMIT 1`, [activeToken]);
      const user = sessionRes.rows[0];
      if (!user) throw new UnauthorizedException({ error: "Invalid or expired session" });

      const nextToken = authTokens.generateToken(user);
      const nextSessionExpiry = authTokens.buildSessionExpiryDate();
      const updateSession = await client.query(`UPDATE user_sessions SET session_token = $1, expires_at = $2, ip_address = $3, user_agent = $4 WHERE account_id = $5 AND session_token = $6 AND expires_at > NOW()`, [nextToken, nextSessionExpiry, this.getClientIp(req), String(req.get("user-agent") || "").slice(0, 512), user.id, activeToken]);

      if (!updateSession.rowCount) throw new ConflictException({ error: "Session refresh conflict; retry login" });
      await this.logAuthSecurityEvent(client, "token_refreshed", { accountId: user.id, ipAddress: this.getClientIp(req), userAgent: String(req.get("user-agent") || "").slice(0, 512) });

      return { status: "success", token: nextToken, expiresIn: authTokens.JWT_ACCESS_TTL_SECONDS };
    } finally { client.release(); }
  }

  async mfaSetup(req: any) {
    const includeQrCode = Boolean(req.body?.includeQrCode);
    const ipAddress = this.getClientIp(req);
    const userAgent = String(req.get("user-agent") || "").slice(0, 512);
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const accountRes = await client.query("SELECT username, user_mfa_enabled FROM accounts WHERE id = $1", [req.user.id]);
      const account = accountRes.rows[0];
      if (!account) throw new NotFoundException({ error: "Account not found" });
      if (account.user_mfa_enabled) throw new ConflictException({ error: "MFA is already enabled" });

      await this.invalidateExpiredUserMfaChallenges(client);
      await client.query("DELETE FROM user_mfa_challenges WHERE account_id = $1 AND purpose = 'enable' AND consumed_at IS NULL", [req.user.id]);

      const setupSecret = this.generateMfaBase32Secret(32);
      const challenge = await this.createUserMfaChallenge(client, { accountId: req.user.id, purpose: "enable", ttlSeconds: USER_MFA_SETUP_TTL_SECONDS, tempSecretEncrypted: encryption.encrypt(setupSecret) });

      await this.logAuthSecurityEvent(client, "user_mfa_setup_started", { accountId: req.user.id, ipAddress, userAgent });

      return { status: "success", challengeToken: challenge.token, expiresIn: challenge.expiresIn, totp: await this.buildMfaSetupPayload({ secret: setupSecret, username: account.username, includeQrCode }) };
    } finally { client.release(); }
  }

  async mfaEnable(req: any) {
    const challengeToken = this.normalizeCredentialField(req.body?.challengeToken, 256);
    const code = this.normalizeCredentialField(req.body?.code, 16);
    const ipAddress = this.getClientIp(req);
    const userAgent = String(req.get("user-agent") || "").slice(0, 512);

    if (!challengeToken || !code) throw new BadRequestException({ error: "Challenge token and code are required" });

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await this.invalidateExpiredUserMfaChallenges(client);
      const challenge = await this.getActiveUserMfaChallenge(client, challengeToken);
      if (!challenge || challenge.purpose !== "enable" || challenge.account_id !== req.user.id) throw new UnauthorizedException({ error: "Invalid or expired MFA setup challenge" });
      if (!challenge.temp_secret_encrypted) {
        await client.query("DELETE FROM user_mfa_challenges WHERE id = $1", [challenge.id]);
        throw new BadRequestException({ error: "MFA setup challenge is incomplete" });
      }

      const setupSecret = encryption.decrypt(challenge.temp_secret_encrypted);
      const codeValid = Boolean(setupSecret) && this.verifyTotpCode(setupSecret, code);

      if (!codeValid) {
        await client.query("UPDATE user_mfa_challenges SET attempts = attempts + 1, updated_at = NOW() WHERE id = $1", [challenge.id]);
        await this.logAuthSecurityEvent(client, "user_mfa_enable_failed", { accountId: req.user.id, ipAddress, userAgent, details: { reason: "bad_code" } });
        throw new UnauthorizedException({ error: "Invalid authenticator code" });
      }

      await client.query("UPDATE accounts SET user_mfa_enabled = TRUE, user_mfa_secret_encrypted = $1, user_mfa_enabled_at = NOW(), updated_at = NOW() WHERE id = $2", [encryption.encrypt(setupSecret!), req.user.id]);
      await client.query("DELETE FROM user_mfa_challenges WHERE account_id = $1", [req.user.id]);
      await this.logAuthSecurityEvent(client, "user_mfa_enabled", { accountId: req.user.id, ipAddress, userAgent });

      return { status: "success", message: "Two-factor authentication enabled", mfa: { enabled: true } };
    } finally { client.release(); }
  }

  async verifyEmail(req: Request, res: Response) {
    const token = this.normalizeCredentialField(req.query.token, 4096);
    const verified = this.verifyEmailVerificationToken(token);
    const redirectBase = `${FRONTEND_ORIGIN.replace(/\/$/, "")}/?page=account`;
    if (!verified) return res.redirect(302, `${redirectBase}&email_verified=0`);

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("UPDATE accounts SET email_verified = TRUE, updated_at = NOW() WHERE id = $1 AND email = $2", [verified.accountId, verified.email]);
      return res.redirect(302, `${redirectBase}&email_verified=1`);
    } catch {
      return res.redirect(302, `${redirectBase}&email_verified=0`);
    } finally { client.release(); }
  }

  async resendVerification(req: any) {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT id, email, name, username, email_verified FROM accounts WHERE id = $1", [req.user.id]);
      const user = result.rows[0];
      if (!user) throw new NotFoundException({ error: "Account not found" });
      if (user.email_verified) return { status: "success", message: "Email already verified" };

      mailer.sendTransactionalEmail({
        to: user.email, subject: "Verify your Filspresso email", text: `Verify your account.`, html: mailer.buildEmailVerificationHtml({ displayName: user.name || user.username, verificationUrl: `${BACKEND_PUBLIC_URL.replace(/\/$/, "")}/api/auth/verify-email?token=${encodeURIComponent(this.createEmailVerificationToken({ accountId: user.id, email: user.email }))}` }),
      }).catch(e => this.logger.warn(e));

      return { status: "success", message: "Verification email sent" };
    } finally { client.release(); }
  }

  async oauthStart(req: Request, res: Response) {
    const provider = String(req.params.provider || "").toLowerCase();
    if (provider !== "google") throw new NotFoundException({ error: "Unknown OAuth provider" });
    const oauthConfig = this.buildOAuthConfig(provider);
    if (!oauthConfig) throw new ServiceUnavailableException({ error: `${provider} OAuth is not configured` });

    const mode = String(req.query.mode || "login").toLowerCase() === "signup" ? "signup" : "login";
    const returnTo = this.safeReturnTo(String(req.query.returnTo || "/?page=account"));
    const state = this.createOAuthState(provider, mode, returnTo);

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", oauthConfig.clientId);
    url.searchParams.set("redirect_uri", oauthConfig.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");
    return res.redirect(302, url.toString());
  }

  async oauthCallback(req: Request, res: Response) {
    const provider = String(req.params.provider || "").toLowerCase();
    if (provider !== "google") throw new NotFoundException({ error: "Unknown OAuth provider" });
    const oauthConfig = this.buildOAuthConfig(provider);
    if (!oauthConfig) throw new ServiceUnavailableException({ error: `${provider} OAuth is not configured` });

    const code = this.normalizeCredentialField(req.query.code, 2048);
    const state = this.normalizeCredentialField(req.query.state, 4096);
    const verifiedState = this.verifyOAuthState(state, provider);
    const returnTo = verifiedState?.returnTo || "/?page=account";

    if (!verifiedState || !code) return res.redirect(302, this.buildOAuthFailureRedirect(returnTo, "invalid_oauth_response"));

    let profile;
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: oauthConfig.clientId, client_secret: oauthConfig.clientSecret, redirect_uri: oauthConfig.redirectUri, grant_type: "authorization_code" }).toString() });
      if (!tokenResponse.ok) throw new Error("Google token exchange failed");
      const tokenData = await tokenResponse.json() as { access_token?: string };
      const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${String(tokenData.access_token || "")}` } });
      if (!userInfoResponse.ok) throw new Error("Google userinfo fetch failed");
      profile = await userInfoResponse.json() as any;
    } catch (error) {
      return res.redirect(302, this.buildOAuthFailureRedirect(returnTo, "oauth_exchange_failed"));
    }

    const providerSubject = this.normalizeCredentialField(profile?.sub, 191);
    const email = this.normalizeCredentialField(profile?.email, 254).toLowerCase();
    const displayName = this.normalizeOAuthProfileName(profile || {}, email);
    const pictureUrl = this.normalizeCredentialField(profile?.picture, 255) || null;

    if (!providerSubject || !email) return res.redirect(302, this.buildOAuthFailureRedirect(returnTo, "oauth_profile_incomplete"));

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const account = await this.findOrCreateOAuthAccount(client, { provider, subject: providerSubject, email, displayName, pictureUrl });
      if (!account) return res.redirect(302, this.buildOAuthFailureRedirect(returnTo, "oauth_account_failed"));

      await client.query("UPDATE accounts SET last_login = NOW(), updated_at = NOW() WHERE id = $1", [account.id]);
      const token = authTokens.generateToken(account);
      const expiresAt = authTokens.buildSessionExpiryDate();
      await client.query("INSERT INTO user_sessions (account_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)", [account.id, token, expiresAt, req.ip, req.get("user-agent")]);
      await this.logAuthSecurityEvent(client, "oauth_login_success", { accountId: account.id, ipAddress: this.getClientIp(req), userAgent: String(req.get("user-agent") || "").slice(0, 512), details: { provider, mode: verifiedState.mode } });

      mailer.sendTransactionalEmail({
        to: account.email, subject: "Filspresso security alert: new login", text: `New login detected.`, html: mailer.buildSecurityLoginHtml({ displayName: account.name || account.username, ipAddress: this.getClientIp(req), userAgent: String(req.get("user-agent") || "").slice(0, 512), occurredAt: new Date().toISOString() }),
      }).catch(e => this.logger.warn(e));

      if (account.isNewAccount) {
        mailer.sendTransactionalEmail({
          to: account.email, subject: "Welcome to Filspresso", text: `Welcome to Filspresso, ${account.name || "there"}.`, html: mailer.buildWelcomeHtml({ displayName: account.name || account.username, accountUrl: `${FRONTEND_ORIGIN.replace(/\/$/, "")}/?page=account` }),
        }).catch(e => this.logger.warn(e));
      }

      return res.redirect(302, this.buildOAuthSuccessRedirect(returnTo, account, token));
    } catch (error) {
      return res.redirect(302, this.buildOAuthFailureRedirect(returnTo, "oauth_login_failed"));
    } finally { client.release(); }
  }
}
