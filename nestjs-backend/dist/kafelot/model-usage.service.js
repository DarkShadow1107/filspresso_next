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
exports.USAGE_SCOPES = exports.ModelUsageService = exports.MODEL_MONTHLY_LIMITS = void 0;
exports.isMeteredModel = isMeteredModel;
exports.modelLimitForTier = modelLimitForTier;
exports.currentMonthYear = currentMonthYear;
exports.nextMonthReset = nextMonthReset;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const kafelot_service_1 = require("./kafelot.service");
Object.defineProperty(exports, "USAGE_SCOPES", { enumerable: true, get: function () { return kafelot_service_1.USAGE_SCOPES; } });
/**
 * Per-model monthly allowances, mirroring `MODEL_MONTHLY_LIMITS` in
 * `src/lib/modelAccess.ts`.
 *
 * The two must agree, because the plans page renders the TypeScript copy to
 * customers while this one decides what is actually enforced. A cross-runtime
 * import is not possible, so `test/model-limits.test.ts` parses the TypeScript
 * source and fails if the tables drift.
 *
 * A value of 0 means "not entitled on this plan", which is distinct from
 * "entitled but exhausted" and must be reported differently so the UI can grey the
 * model out rather than showing a used-up quota.
 */
exports.MODEL_MONTHLY_LIMITS = {
    // prettier-ignore
    lfm2_5_230m_q4_k_m: { free: 15, basic: 50, plus: 100, pro: 150, max: 300, ultimate: 1000 },
    lfm2_5_350m_q8_0: { basic: 40, plus: 80, pro: 120, max: 240, ultimate: 800 },
    lfm2_5_1_2b_instruct_q4_k_m: { plus: 60, pro: 90, max: 180, ultimate: 600 },
    lfm2_5_1_2b_thinking_q4_k_m: { pro: 60, max: 120, ultimate: 400 },
    lfm2_5_2_6b_q4_0: { max: 90, ultimate: 300 },
    lfm2_5_8b_a1b_q4_k_m: { ultimate: 120 },
    lfm2_5_vl_450m_q4_k_m: { plus: 50, pro: 70, max: 140, ultimate: 450 },
    lfm2_5_vl_3b_q4_k_m: { max: 70, ultimate: 220 },
    lfm2_5_audio_1_5b_q4_0: { ultimate: 150 },
};
/** True when the model key is one we meter. Unknown keys are rejected, not ignored. */
function isMeteredModel(modelKey) {
    return Object.prototype.hasOwnProperty.call(exports.MODEL_MONTHLY_LIMITS, modelKey);
}
/** Monthly allowance for one model on one plan; 0 means not entitled. */
function modelLimitForTier(modelKey, tier) {
    if (!isMeteredModel(modelKey))
        return 0;
    const row = exports.MODEL_MONTHLY_LIMITS[modelKey];
    const key = String(tier || "free").trim().toLowerCase();
    return row[key] ?? 0;
}
let ModelUsageService = class ModelUsageService {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Current per-model usage for every metered model on a plan.
     *
     * Returned by the status endpoint so the client can grey out a model whose
     * allowance is spent rather than letting the user discover it via a 429.
     */
    async allowancesForTier(accountId, tier, usageScope) {
        const pool = this.db.getPool();
        const scope = (0, kafelot_service_1.normalizeUsageScope)(usageScope);
        const { rows } = await pool.query(`SELECT model_key, prompts_used FROM kafelot_prompt_usage
			 WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key <> ''`, [accountId, currentMonthYear(), scope]);
        const usedByModel = new Map(rows.map((r) => [
            String(r.model_key),
            Number(r.prompts_used) || 0,
        ]));
        return Object.keys(exports.MODEL_MONTHLY_LIMITS).map((modelKey) => {
            const limit = modelLimitForTier(modelKey, tier);
            const used = usedByModel.get(modelKey) ?? 0;
            return {
                modelKey,
                limit,
                used,
                remaining: Math.max(0, limit - used),
                notEntitled: limit <= 0,
            };
        });
    }
    /**
     * Whether a model may be used right now, and why not if it may not.
     *
     * Kept separate from `checkAndUse` so the client's dry-run can ask the question
     * without consuming anything.
     */
    async checkModelAllowance(accountId, tier, usageScope, modelKey) {
        const limit = modelLimitForTier(modelKey, tier);
        const scope = (0, kafelot_service_1.normalizeUsageScope)(usageScope);
        const pool = this.db.getPool();
        const { rows } = await pool.query(`SELECT prompts_used FROM kafelot_prompt_usage
			 WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key = $4`, [accountId, currentMonthYear(), scope, modelKey]);
        const used = Number(rows[0]?.prompts_used) || 0;
        const allowance = {
            modelKey,
            limit,
            used,
            remaining: Math.max(0, limit - used),
            notEntitled: limit <= 0,
        };
        if (limit <= 0)
            return { allowed: false, reason: "model_not_in_plan", allowance };
        if (used >= limit)
            return { allowed: false, reason: "model_allowance_exhausted", allowance };
        return { allowed: true, allowance };
    }
    /** Increment a model's sub-count. Called inside the same transaction as the scope total. */
    async consumeModel(client, accountId, usageScope, modelKey) {
        await client.query(`INSERT INTO kafelot_prompt_usage
			   (account_id, month_year, usage_scope, model_key, prompts_used, prompts_limit, subscription_tier, reset_date)
			 VALUES ($1, $2, $3, $4, 0, 0, '', $5)
			 ON CONFLICT (account_id, month_year, usage_scope, model_key) DO NOTHING`, [accountId, currentMonthYear(), (0, kafelot_service_1.normalizeUsageScope)(usageScope), modelKey, nextMonthReset()]);
        await client.query(`UPDATE kafelot_prompt_usage SET prompts_used = prompts_used + 1, updated_at = CURRENT_TIMESTAMP
			 WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key = $4`, [accountId, currentMonthYear(), (0, kafelot_service_1.normalizeUsageScope)(usageScope), modelKey]);
    }
};
exports.ModelUsageService = ModelUsageService;
exports.ModelUsageService = ModelUsageService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], ModelUsageService);
function currentMonthYear() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonthReset() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
}
