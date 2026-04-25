import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

export const USAGE_SCOPES = { GENERAL: "general", MOLECULE_HELPER: "molecule_helper" } as const;
export type UsageScope = typeof USAGE_SCOPES[keyof typeof USAGE_SCOPES];
export const VALID_USAGE_SCOPES = new Set<string>(Object.values(USAGE_SCOPES));

function parseLimitFromEnv(envValue: string | undefined, fallback: number, minimum = 1) {
  const parsed = Number.parseInt(String(envValue || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

const GENERAL_PROMPT_LIMITS: Record<string, number> = {
  anonymous: parseLimitFromEnv(process.env.KAFELOT_LIMIT_ANONYMOUS, 25),
  free: parseLimitFromEnv(process.env.KAFELOT_LIMIT_FREE, 15),
  basic: parseLimitFromEnv(process.env.KAFELOT_LIMIT_BASIC, 50),
  plus: parseLimitFromEnv(process.env.KAFELOT_LIMIT_PLUS, 100),
  pro: parseLimitFromEnv(process.env.KAFELOT_LIMIT_PRO, 150),
  max: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MAX, 300),
  ultimate: parseLimitFromEnv(process.env.KAFELOT_LIMIT_ULTIMATE, 1000),
};

const MOLECULE_HELPER_DEFAULT_LIMIT = parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_HELPER, 200);

const MOLECULE_PROMPT_LIMITS: Record<string, number> = {
  anonymous: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_ANONYMOUS, GENERAL_PROMPT_LIMITS["anonymous"]),
  free: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_FREE, MOLECULE_HELPER_DEFAULT_LIMIT),
  basic: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_BASIC, MOLECULE_HELPER_DEFAULT_LIMIT),
  plus: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_PLUS, MOLECULE_HELPER_DEFAULT_LIMIT),
  pro: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_PRO, MOLECULE_HELPER_DEFAULT_LIMIT),
  max: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_MAX, MOLECULE_HELPER_DEFAULT_LIMIT),
  ultimate: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_ULTIMATE, MOLECULE_HELPER_DEFAULT_LIMIT),
};

const PROMPT_LIMITS_BY_SCOPE: Record<string, Record<string, number>> = {
  [USAGE_SCOPES.GENERAL]: GENERAL_PROMPT_LIMITS,
  [USAGE_SCOPES.MOLECULE_HELPER]: MOLECULE_PROMPT_LIMITS,
};

function nextMonthReset() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString().split("T")[0];
}

function currentMonthYear() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function normalizeUsageScope(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return USAGE_SCOPES.GENERAL;
  if (VALID_USAGE_SCOPES.has(normalized)) return normalized;
  return USAGE_SCOPES.GENERAL;
}

function scopeLimits(usageScope: string) {
  const normalizedScope = normalizeUsageScope(usageScope);
  return PROMPT_LIMITS_BY_SCOPE[normalizedScope] || GENERAL_PROMPT_LIMITS;
}

function normalizeTier(tier?: string | null) {
  const normalized = String(tier || "").trim().toLowerCase();
  if (!normalized || normalized === "none") return "free";
  if (Object.prototype.hasOwnProperty.call(GENERAL_PROMPT_LIMITS, normalized)) return normalized;
  return "free";
}

function tierToLimit(tier: string | undefined | null, usageScope: string = USAGE_SCOPES.GENERAL) {
  const t = normalizeTier(tier);
  const limits = scopeLimits(usageScope);
  return limits[t] ?? limits["free"] ?? GENERAL_PROMPT_LIMITS["free"];
}

@Injectable()
export class KafelotService {
  constructor(private readonly db: DatabaseService) {}

  private async fetchUserTier(client: any, accountId: number): Promise<string> {
    try {
      const { rows } = await client.query(
        `SELECT subscription_tier FROM user_subscriptions
         WHERE account_id = $1 AND status IN ('active','ending')
         ORDER BY is_active DESC, created_at DESC LIMIT 1`,
        [accountId],
      );
      if (rows[0]?.subscription_tier) return normalizeTier(rows[0].subscription_tier);
      const accountResult = await client.query("SELECT subscription FROM accounts WHERE id = $1 LIMIT 1", [accountId]);
      return normalizeTier(accountResult.rows[0]?.subscription || "free");
    } catch { return "free"; }
  }

  private async getOrCreateAnonymous(client: any, fingerprint: string, ip: string | null, userAgent: string, systemInfo: any, usageScope: string = USAGE_SCOPES.GENERAL) {
    const resetDate = nextMonthReset();
    const anonLimit = scopeLimits(usageScope)["anonymous"] ?? GENERAL_PROMPT_LIMITS["anonymous"];
    await client.query(
      `INSERT INTO kafelot_anonymous_users (fingerprint, ip_address, user_agent, system_info, reset_date, prompts_limit)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (fingerprint) DO UPDATE
         SET ip_address = EXCLUDED.ip_address, user_agent = EXCLUDED.user_agent, system_info = EXCLUDED.system_info,
             prompts_limit = EXCLUDED.prompts_limit,
             prompts_used = CASE WHEN kafelot_anonymous_users.prompts_limit <> EXCLUDED.prompts_limit THEN 0 ELSE kafelot_anonymous_users.prompts_used END,
             updated_at = CURRENT_TIMESTAMP`,
      [fingerprint, ip, userAgent, systemInfo, resetDate, anonLimit],
    );
    await client.query(
      `UPDATE kafelot_anonymous_users SET prompts_used = 0, reset_date = $1::DATE, updated_at = CURRENT_TIMESTAMP
       WHERE fingerprint = $2 AND reset_date <= CURRENT_DATE`,
      [resetDate, fingerprint],
    );
    const { rows } = await client.query(`SELECT * FROM kafelot_anonymous_users WHERE fingerprint = $1`, [fingerprint]);
    return rows[0];
  }

  private async getOrCreateUserUsage(client: any, accountId: number, tier: string, usageScope: string = USAGE_SCOPES.GENERAL) {
    const monthYear = currentMonthYear();
    const resetDate = nextMonthReset();
    const normalizedScope = normalizeUsageScope(usageScope);
    const limit = tierToLimit(tier, normalizedScope);
    await client.query(
      `INSERT INTO kafelot_prompt_usage (account_id, month_year, usage_scope, prompts_limit, subscription_tier, reset_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, month_year, usage_scope) DO UPDATE
         SET subscription_tier = EXCLUDED.subscription_tier, prompts_limit = EXCLUDED.prompts_limit,
             prompts_used = CASE WHEN kafelot_prompt_usage.prompts_limit <> EXCLUDED.prompts_limit THEN 0 ELSE kafelot_prompt_usage.prompts_used END,
             updated_at = CURRENT_TIMESTAMP`,
      [accountId, monthYear, normalizedScope, limit, tier, resetDate],
    );
    const { rows } = await client.query(
      `SELECT * FROM kafelot_prompt_usage WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3`,
      [accountId, monthYear, normalizedScope],
    );
    return rows[0];
  }

  async checkAndUse(params: {
    accountId?: number; fingerprint?: string; ip: string | null; userAgent: string;
    systemInfo: any; dryRun: boolean; usageScope: string; hasBearerToken: boolean;
  }): Promise<any> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (params.accountId) {
        const tier = await this.fetchUserTier(client, params.accountId);
        const row = await this.getOrCreateUserUsage(client, params.accountId, tier, params.usageScope);
        if (row.prompts_used >= row.prompts_limit) {
          await client.query("ROLLBACK");
          return { status: 429, data: { error: "PROMPT_LIMIT_REACHED", prompts_remaining: 0, prompts_limit: row.prompts_limit, reset_date: row.reset_date, tier, scope: params.usageScope } };
        }
        if (params.dryRun) {
          await client.query("COMMIT");
          return { status: 200, data: { allowed: true, prompts_remaining: row.prompts_limit - row.prompts_used, prompts_limit: row.prompts_limit, reset_date: row.reset_date, tier, scope: params.usageScope } };
        }
        await client.query(
          `UPDATE kafelot_prompt_usage SET prompts_used = prompts_used + 1, updated_at = CURRENT_TIMESTAMP
           WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3`,
          [params.accountId, currentMonthYear(), normalizeUsageScope(params.usageScope)],
        );
        await client.query("COMMIT");
        return { status: 200, data: { allowed: true, prompts_remaining: row.prompts_limit - row.prompts_used - 1, prompts_limit: row.prompts_limit, reset_date: row.reset_date, tier, scope: params.usageScope } };
      } else {
        if (!params.fingerprint) {
          const anonLimit = scopeLimits(params.usageScope)["anonymous"] ?? GENERAL_PROMPT_LIMITS["anonymous"];
          await client.query("ROLLBACK");
          return { status: 200, data: { allowed: true, prompts_remaining: anonLimit, prompts_limit: anonLimit, scope: params.usageScope } };
        }
        const row = await this.getOrCreateAnonymous(client, params.fingerprint, params.ip, params.userAgent, params.systemInfo, params.usageScope);
        if (row.prompts_used >= row.prompts_limit) {
          await client.query("ROLLBACK");
          return { status: 429, data: { error: "PROMPT_LIMIT_REACHED", prompts_remaining: 0, prompts_limit: row.prompts_limit, reset_date: row.reset_date, tier: "anonymous", scope: params.usageScope } };
        }
        if (params.dryRun) {
          await client.query("COMMIT");
          return { status: 200, data: { allowed: true, prompts_remaining: row.prompts_limit - row.prompts_used, prompts_limit: row.prompts_limit, reset_date: row.reset_date, tier: "anonymous", scope: params.usageScope } };
        }
        await client.query("UPDATE kafelot_anonymous_users SET prompts_used = prompts_used + 1, updated_at = CURRENT_TIMESTAMP WHERE fingerprint = $1", [params.fingerprint]);
        await client.query("COMMIT");
        return { status: 200, data: { allowed: true, prompts_remaining: row.prompts_limit - row.prompts_used - 1, prompts_limit: row.prompts_limit, reset_date: row.reset_date, tier: "anonymous", scope: params.usageScope } };
      }
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      return { status: 200, data: { allowed: true, prompts_remaining: -1, prompts_limit: -1 } };
    } finally { client.release(); }
  }

  async getStatus(params: {
    accountId?: number; fingerprint?: string; ip: string | null;
    userAgent: string; usageScope: string; hasBearerToken: boolean;
  }): Promise<any> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      if (params.accountId) {
        const tier = await this.fetchUserTier(client, params.accountId);
        const row = await this.getOrCreateUserUsage(client, params.accountId, tier, params.usageScope);
        return { status: 200, data: { prompts_remaining: Math.max(0, row.prompts_limit - row.prompts_used), prompts_used: row.prompts_used, prompts_limit: row.prompts_limit, reset_date: row.reset_date, tier, scope: params.usageScope } };
      } else {
        if (!params.fingerprint) {
          const anonLimit = scopeLimits(params.usageScope)["anonymous"] ?? GENERAL_PROMPT_LIMITS["anonymous"];
          return { status: 200, data: { prompts_remaining: anonLimit, prompts_used: 0, prompts_limit: anonLimit, tier: "anonymous", scope: params.usageScope } };
        }
        const row = await this.getOrCreateAnonymous(client, params.fingerprint, params.ip, params.userAgent, {}, params.usageScope);
        return { status: 200, data: { prompts_remaining: Math.max(0, row.prompts_limit - row.prompts_used), prompts_used: row.prompts_used, prompts_limit: row.prompts_limit, reset_date: row.reset_date, tier: "anonymous", scope: params.usageScope } };
      }
    } catch {
      const anonLimit = scopeLimits(params.usageScope)["anonymous"] ?? GENERAL_PROMPT_LIMITS["anonymous"];
      return { status: 200, data: { prompts_remaining: anonLimit, prompts_limit: anonLimit, tier: "anonymous", scope: params.usageScope } };
    } finally { client.release(); }
  }

  async getAnonymousUsers(limit: number, offset: number, search: string): Promise<any> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), 200);
      const safeOffset = Math.max(Number.isInteger(offset) ? offset : 0, 0);
      const whereClause = search ? `WHERE fingerprint ILIKE $3 OR ip_address ILIKE $3` : "";
      const params: any[] = search ? [safeLimit, safeOffset, `%${search}%`] : [safeLimit, safeOffset];
      const { rows } = await client.query(
        `SELECT *, ('A' || id) AS display_id FROM kafelot_anonymous_users ${whereClause} ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
        params,
      );
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*) AS total FROM kafelot_anonymous_users ${whereClause}`,
        search ? [`%${search}%`] : [],
      );
      return { users: rows, total: Number(countRows[0].total) };
    } finally { client.release(); }
  }

  async updateAnonymousUser(id: number, promptsLimit?: number, promptsUsed?: number): Promise<any> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `UPDATE kafelot_anonymous_users
         SET prompts_limit = COALESCE($1, prompts_limit), prompts_used = COALESCE($2, prompts_used), updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING *, ('A' || id) AS display_id`,
        [promptsLimit, promptsUsed, id],
      );
      if (!rows[0]) throw new NotFoundException({ error: "Not found" });
      return rows[0];
    } finally { client.release(); }
  }

  async getUsersUsage(limit: number, offset: number, monthYear?: string, scope?: string): Promise<any> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), 200);
      const safeOffset = Math.max(Number.isInteger(offset) ? offset : 0, 0);
      const filterParams: any[] = [];
      const rowsFilters: string[] = [];
      const countFilters: string[] = [];
      let rowsParamIndex = 3;
      let countParamIndex = 1;
      if (monthYear) {
        rowsFilters.push(`kpu.month_year = $${rowsParamIndex++}`); countFilters.push(`kpu.month_year = $${countParamIndex++}`);
        filterParams.push(monthYear);
      }
      if (scope) {
        rowsFilters.push(`kpu.usage_scope = $${rowsParamIndex++}`); countFilters.push(`kpu.usage_scope = $${countParamIndex++}`);
        filterParams.push(normalizeUsageScope(scope));
      }
      const rowsWhereClause = rowsFilters.length > 0 ? `WHERE ${rowsFilters.join(" AND ")}` : "";
      const countWhereClause = countFilters.length > 0 ? `WHERE ${countFilters.join(" AND ")}` : "";
      const params = [safeLimit, safeOffset, ...filterParams];
      const { rows } = await client.query(
        `SELECT kpu.*, a.username, a.email FROM kafelot_prompt_usage kpu JOIN accounts a ON kpu.account_id = a.id
         ${rowsWhereClause} ORDER BY kpu.updated_at DESC LIMIT $1 OFFSET $2`,
        params,
      );
      const { rows: countRows } = await client.query(`SELECT COUNT(*) AS total FROM kafelot_prompt_usage kpu ${countWhereClause}`, filterParams);
      return { users: rows, total: Number(countRows[0].total) };
    } finally { client.release(); }
  }

  async updateUserUsage(id: number, promptsLimit?: number, promptsUsed?: number): Promise<any> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `UPDATE kafelot_prompt_usage
         SET prompts_limit = COALESCE($1, prompts_limit), prompts_used = COALESCE($2, prompts_used), updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING *`,
        [promptsLimit, promptsUsed, id],
      );
      if (!rows[0]) throw new NotFoundException({ error: "Not found" });
      return rows[0];
    } finally { client.release(); }
  }
}
