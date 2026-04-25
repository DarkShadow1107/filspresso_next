import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as authTokens from "../common/utils/auth-tokens";
import * as passwords from "../common/utils/passwords";

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Validate a Bearer token and return user claims.
   */
  verifyBearerToken(token: string): Record<string, unknown> {
    const decoded = authTokens.verifyToken(token);
    if (!decoded) {
      throw new UnauthorizedException({ error: "Invalid or expired token" });
    }
    return decoded;
  }

  /**
   * Retrieve the authenticated user from the database by account ID from JWT claims.
   */
  async getMe(accountId: number): Promise<Record<string, unknown>> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, username, email, name, icon, role, created_at, subscription,
                user_mfa_enabled, email_verified
         FROM accounts WHERE id = $1 LIMIT 1`,
        [accountId],
      );
      const user = result.rows[0];
      if (!user) {
        throw new NotFoundException({ error: "Account not found" });
      }
      return user as Record<string, unknown>;
    } finally {
      client.release();
    }
  }

  /**
   * Invalidate a session token (logout).
   */
  async invalidateSession(token: string): Promise<void> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query(
        "DELETE FROM user_sessions WHERE session_token = $1",
        [token],
      );
    } catch {
      // Best-effort logout — do not fail the response on DB error
    } finally {
      client.release();
    }
  }

  /**
   * List active sessions for an account.
   */
  async getSessions(accountId: number): Promise<unknown[]> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, ip_address, user_agent, created_at, expires_at
         FROM user_sessions
         WHERE account_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [accountId],
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Revoke a specific session belonging to an account.
   */
  async revokeSession(accountId: number, sessionId: number): Promise<void> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        "DELETE FROM user_sessions WHERE id = $1 AND account_id = $2 RETURNING id",
        [sessionId, accountId],
      );
      if (!result.rowCount) {
        throw new NotFoundException({ error: "Session not found" });
      }
    } finally {
      client.release();
    }
  }

  /**
   * Change password — verifies old password, hashes new one.
   */
  async changePassword(
    accountId: number,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (
      typeof newPassword !== "string" ||
      newPassword.length < 8 ||
      newPassword.length > 128
    ) {
      throw new BadRequestException({
        error: "New password must be between 8 and 128 characters",
      });
    }

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        "SELECT password_hash FROM accounts WHERE id = $1 LIMIT 1",
        [accountId],
      );
      const row = result.rows[0];
      if (!row) {
        throw new NotFoundException({ error: "Account not found" });
      }

      const valid = await passwords.verifyPassword(
        oldPassword,
        String(row.password_hash),
      );
      if (!valid) {
        throw new UnauthorizedException({ error: "Current password is incorrect" });
      }

      const newHash = await passwords.hashPassword(newPassword);
      await client.query(
        "UPDATE accounts SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        [newHash, accountId],
      );
    } finally {
      client.release();
    }
  }

  /**
   * Change email — updates and marks as unverified.
   */
  async changeEmail(accountId: number, newEmail: string): Promise<void> {
    const normalized = String(newEmail || "")
      .trim()
      .toLowerCase()
      .slice(0, 254);
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BadRequestException({ error: "Invalid email address" });
    }

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const existing = await client.query(
        "SELECT id FROM accounts WHERE email = $1 AND id != $2 LIMIT 1",
        [normalized, accountId],
      );
      if (existing.rows[0]) {
        throw new BadRequestException({ error: "Email already in use" });
      }
      await client.query(
        "UPDATE accounts SET email = $1, email_verified = FALSE, updated_at = NOW() WHERE id = $2",
        [normalized, accountId],
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get recent auth security events for an account.
   */
  async getSecurityEvents(
    accountId: number,
    limit = 20,
  ): Promise<unknown[]> {
    const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 20, 1), 200);
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT event_type, ip_address, user_agent, occurred_at, details
         FROM auth_security_events
         WHERE account_id = $1
         ORDER BY occurred_at DESC
         LIMIT $2`,
        [accountId, safeLimit],
      );
      return result.rows;
    } catch {
      // auth_security_events table may not exist in older schema
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get MFA status for an account.
   */
  async getMfaStatus(accountId: number): Promise<{ enabled: boolean }> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        "SELECT user_mfa_enabled FROM accounts WHERE id = $1 LIMIT 1",
        [accountId],
      );
      return { enabled: Boolean(result.rows[0]?.user_mfa_enabled) };
    } finally {
      client.release();
    }
  }

  /**
   * Disable MFA for an account (after password verification).
   */
  async disableMfa(accountId: number, password: string): Promise<void> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        "SELECT password_hash FROM accounts WHERE id = $1 LIMIT 1",
        [accountId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException({ error: "Account not found" });

      const valid = await passwords.verifyPassword(
        password,
        String(row.password_hash),
      );
      if (!valid) {
        throw new UnauthorizedException({ error: "Password is incorrect" });
      }

      await client.query(
        `UPDATE accounts
         SET user_mfa_enabled = FALSE,
             user_mfa_secret_encrypted = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [accountId],
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get OIDC configuration availability.
   */
  getOidcAvailability(): boolean {
    try {
      return authTokens.jwtSupportsOidcJwks();
    } catch {
      return false;
    }
  }

  /**
   * Get OIDC configuration document.
   */
  getOpenIdConfiguration(baseUrl: string): Record<string, unknown> {
    return authTokens.getOpenIdConfiguration(baseUrl);
  }

  /**
   * Get JWKS.
   */
  getJwks(): Record<string, unknown> {
    return authTokens.getJwtJwks();
  }
}
