import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { modelLimitForTier } from "./model-usage.service";

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

  /**
   * The caller's authoritative tier, for gates that run outside a transaction.
   *
   * `fetchUserTier` is private and needs a client; this exposes the same lookup on
   * its own connection so a controller can gate a request before consuming quota.
   */
  async resolveTier(accountId: number): Promise<string> {
    const pool = this.db.getPool();
    return this.fetchUserTier(pool, accountId);
  }

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

  private async readAnonymousUsage(client: any, fingerprint: string, usageScope: string = USAGE_SCOPES.GENERAL) {
    const { rows } = await client.query(
      `SELECT * FROM kafelot_anonymous_users WHERE fingerprint = $1`,
      [fingerprint],
    );
    if (rows[0]) return rows[0];
    // Read-only counterpart to `getOrCreateAnonymous`: report the derived
    // allowance for a fingerprint that has never been seen, without inserting.
    return {
      fingerprint,
      prompts_used: 0,
      prompts_limit: scopeLimits(usageScope)["anonymous"] ?? GENERAL_PROMPT_LIMITS["anonymous"],
      reset_date: nextMonthReset(),
    };
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

  private async readUserUsage(client: any, accountId: number, tier: string, usageScope: string = USAGE_SCOPES.GENERAL) {
    const monthYear = currentMonthYear();
    const normalizedScope = normalizeUsageScope(usageScope);
    const { rows } = await client.query(
      `SELECT * FROM kafelot_prompt_usage WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key = ''`,
      [accountId, monthYear, normalizedScope],
    );
    if (rows[0]) return rows[0];
    // No row yet: report the derived allowance without creating one. Callers that
    // only read must not mutate the table.
    return {
      account_id: accountId,
      month_year: monthYear,
      usage_scope: normalizedScope,
      prompts_used: 0,
      prompts_limit: tierToLimit(tier, normalizedScope),
      subscription_tier: tier,
      reset_date: nextMonthReset(),
    };
  }

  /**
   * Fetch-or-create one model's sub-count row.
   *
   * Mirrors `getOrCreateUserUsage` but keys on `model_key`, and takes the limit as
   * an argument because a model's allowance comes from `MODEL_MONTHLY_LIMITS` rather
   * than from the tier-to-scope mapping. A limit of 0 is stored, not rejected, so the
   * caller can report `model_not_in_plan` with the real numbers instead of guessing.
   */
  private async getOrCreateModelUsage(client: any, accountId: number, usageScope: string, modelKey: string, limit: number) {
    const monthYear = currentMonthYear();
    const resetDate = nextMonthReset();
    const normalizedScope = normalizeUsageScope(usageScope);
    await client.query(
      `INSERT INTO kafelot_prompt_usage (account_id, month_year, usage_scope, model_key, prompts_limit, subscription_tier, reset_date)
       VALUES ($1, $2, $3, $4, $5, '', $6)
       ON CONFLICT (account_id, month_year, usage_scope, model_key) DO UPDATE
         SET prompts_limit = EXCLUDED.prompts_limit, updated_at = CURRENT_TIMESTAMP`,
      [accountId, monthYear, normalizedScope, modelKey, limit, resetDate],
    );
    const { rows } = await client.query(
      `SELECT * FROM kafelot_prompt_usage WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key = $4`,
      [accountId, monthYear, normalizedScope, modelKey],
    );
    return rows[0];
  }

  /** Increment a model's sub-count. Called inside the caller's transaction. */
  private async consumeModelUsage(client: any, accountId: number, usageScope: string, modelKey: string): Promise<void> {
    await client.query(
      `UPDATE kafelot_prompt_usage SET prompts_used = prompts_used + 1, updated_at = CURRENT_TIMESTAMP
       WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key = $4`,
      [accountId, currentMonthYear(), normalizeUsageScope(usageScope), modelKey],
    );
  }

  private async getOrCreateUserUsage(client: any, accountId: number, tier: string, usageScope: string = USAGE_SCOPES.GENERAL) {
    const monthYear = currentMonthYear();
    const resetDate = nextMonthReset();
    const normalizedScope = normalizeUsageScope(usageScope);
    const limit = tierToLimit(tier, normalizedScope);
    await client.query(
      `INSERT INTO kafelot_prompt_usage (account_id, month_year, usage_scope, prompts_limit, subscription_tier, reset_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, month_year, usage_scope, model_key) DO UPDATE
         SET subscription_tier = EXCLUDED.subscription_tier, prompts_limit = EXCLUDED.prompts_limit,
             updated_at = CURRENT_TIMESTAMP`,
      [accountId, monthYear, normalizedScope, limit, tier, resetDate],
    );
    const { rows } = await client.query(
      `SELECT * FROM kafelot_prompt_usage WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key = ''`,
      [accountId, monthYear, normalizedScope],
    );
    return rows[0];
  }

  async checkAndUse(params: {
    accountId?: number; fingerprint?: string; ip: string | null; userAgent: string;
    systemInfo: any; dryRun: boolean; usageScope: string; hasBearerToken: boolean;
    /**
     * The model this request will use, for per-model metering.
     *
     * Optional on purpose: an absent key means "meter the scope total only", which
     * is what the anonymous path and any pre-model-resolution dry-run do.
     */
    modelKey?: string | null;
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

        // Per-model allowance. Checked after the scope total and inside the same
        // transaction, so the two cannot disagree: a request must satisfy both.
        let modelAllowance: Record<string, unknown> | null = null;
        if (params.modelKey) {
          const limit = modelLimitForTier(params.modelKey, tier);
          const modelRow = await this.getOrCreateModelUsage(client, params.accountId, params.usageScope, params.modelKey, limit);
          modelAllowance = {
            model_key: params.modelKey,
            prompts_limit: modelRow.prompts_limit,
            prompts_used: modelRow.prompts_used,
            prompts_remaining: Math.max(0, modelRow.prompts_limit - modelRow.prompts_used),
          };
          if (modelRow.prompts_limit <= 0) {
            await client.query("ROLLBACK");
            return { status: 403, data: { error: "MODEL_NOT_IN_PLAN", model_key: params.modelKey, tier, scope: params.usageScope, ...modelAllowance } };
          }
          if (modelRow.prompts_used >= modelRow.prompts_limit) {
            await client.query("ROLLBACK");
            // Distinct from PROMPT_LIMIT_REACHED so the UI can grey the model out and
            // let the user pick another, rather than implying the whole plan is spent.
            return { status: 429, data: { error: "MODEL_ALLOWANCE_EXHAUSTED", model_key: params.modelKey, reset_date: row.reset_date, tier, scope: params.usageScope, ...modelAllowance } };
          }
        }
        if (params.dryRun) {
          await client.query("COMMIT");
          // The dry-run reports the model's own remaining count too, so the client can
          // show "12 / 120 on this model" before the user commits a prompt. Omitting
          // it made every dry-run look like an unknown allowance.
          return {
            status: 200,
            data: {
              allowed: true,
              prompts_remaining: row.prompts_limit - row.prompts_used,
              prompts_limit: row.prompts_limit,
              reset_date: row.reset_date,
              tier,
              scope: params.usageScope,
              ...(modelAllowance
                ? {
                    model_key: modelAllowance.model_key,
                    model_prompts_remaining: modelAllowance.prompts_remaining,
                    model_prompts_limit: modelAllowance.prompts_limit,
                    model_prompts_used: modelAllowance.prompts_used,
                  }
                : {}),
            },
          };
        }
        await client.query(
          `UPDATE kafelot_prompt_usage SET prompts_used = prompts_used + 1, updated_at = CURRENT_TIMESTAMP
           WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key = ''`,
          [params.accountId, currentMonthYear(), normalizeUsageScope(params.usageScope)],
        );
        if (params.modelKey) {
          await this.consumeModelUsage(client, params.accountId, params.usageScope, params.modelKey);
        }
        await client.query("COMMIT");
        return {
          status: 200,
          data: {
            allowed: true,
            prompts_remaining: row.prompts_limit - row.prompts_used - 1,
            prompts_limit: row.prompts_limit,
            reset_date: row.reset_date,
            tier,
            scope: params.usageScope,
            ...(modelAllowance
              ? {
                  model_key: modelAllowance.model_key,
                  model_prompts_remaining:
                    Number(modelAllowance.prompts_remaining) - 1,
                }
              : {}),
          },
        };
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
      // Fail CLOSED. This used to return `{ allowed: true, prompts_remaining: -1 }`,
      // which the Next wrapper could not distinguish from a real allowance and
      // therefore served every request unmetered whenever the database hiccuped --
      // the exact opposite of what its own docstring promised. A non-2xx here is
      // what `promptLimits.ts` turns into a 503 PROMPT_LIMIT_UNAVAILABLE.
      return {
        status: 503,
        data: {
          error: "PROMPT_LIMIT_UNAVAILABLE",
          message: "Could not verify your prompt allowance.",
        },
      };
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
        // Read-only. This used to call `getOrCreateUserUsage`, which meant a plain
        // status poll INSERTed a row and -- via the `prompts_used = CASE ...` clause
        // since removed -- could silently zero a user's usage whenever the derived
        // limit changed. Reporting state must never mutate it.
        const row = await this.readUserUsage(client, params.accountId, tier, params.usageScope);
        return { status: 200, data: { prompts_remaining: Math.max(0, row.prompts_limit - row.prompts_used), prompts_used: row.prompts_used, prompts_limit: row.prompts_limit, reset_date: row.reset_date, tier, scope: params.usageScope } };
      } else {
        if (!params.fingerprint) {
          const anonLimit = scopeLimits(params.usageScope)["anonymous"] ?? GENERAL_PROMPT_LIMITS["anonymous"];
          return { status: 200, data: { prompts_remaining: anonLimit, prompts_used: 0, prompts_limit: anonLimit, tier: "anonymous", scope: params.usageScope } };
        }
        const row = await this.readAnonymousUsage(client, params.fingerprint, params.usageScope);
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
