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
exports.USAGE_SCOPES = exports.ModelUsageService = exports.MODEL_TIER_ACCESS = void 0;
exports.isMeteredModel = isMeteredModel;
exports.tierAllowsModel = tierAllowsModel;
exports.currentMonthYear = currentMonthYear;
exports.nextMonthReset = nextMonthReset;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const kafelot_service_1 = require("./kafelot.service");
Object.defineProperty(exports, "USAGE_SCOPES", { enumerable: true, get: function () { return kafelot_service_1.USAGE_SCOPES; } });
/**
 * Which plans may use which model.
 *
 * This used to be a quota table -- `{ model: { tier: prompts-per-month } }` -- and the
 * numbers are gone. Usage is now metered in RON (`billing/tier-allowance.ts`), so a prompt
 * count would be a second, contradictory budget: a customer entitled to 15 RON of 230M
 * could be refused mid-conversation for "prompts" while holding most of that 15 RON
 * unspent. One budget, one meter.
 *
 * Entitlement survives the change, and has to: it is the only thing stopping a free
 * account from reaching the 8B A1B. So this is a membership matrix, not a quota.
 *
 * It lives in the backend and is fetched, not copied into `src/lib/modelAccess.ts` --
 * see `billing/model-pricing.ts` for why a duplicated money table is worse than a
 * duplicated prompt limit.
 */
// prettier-ignore
exports.MODEL_TIER_ACCESS = {
    lfm2_5_230m_q4_k_m: { free: true, basic: true, plus: true, pro: true, max: true, ultimate: true },
    lfm2_5_350m_q8_0: { basic: true, plus: true, pro: true, max: true, ultimate: true },
    lfm2_5_1_2b_instruct_q4_k_m: { plus: true, pro: true, max: true, ultimate: true },
    lfm2_5_1_2b_thinking_q4_k_m: { pro: true, max: true, ultimate: true },
    lfm2_5_2_6b_q4_0: { max: true, ultimate: true },
    lfm2_5_8b_a1b_q4_k_m: { ultimate: true },
    lfm2_5_vl_450m_q4_k_m: { plus: true, pro: true, max: true, ultimate: true },
    lfm2_5_vl_3b_q4_k_m: { max: true, ultimate: true },
    lfm2_5_audio_1_5b_q4_0: { ultimate: true },
};
/** True when the model is one we meter. Unknown keys are rejected, not ignored. */
function isMeteredModel(modelKey) {
    return Object.prototype.hasOwnProperty.call(exports.MODEL_TIER_ACCESS, modelKey);
}
/**
 * Whether this plan may use this model at all.
 *
 * Membership is tested explicitly. An unrecognised tier returns false, because defaulting
 * it to true would hand a new or misspelled plan every model in the lineup.
 */
function tierAllowsModel(modelKey, tier) {
    if (!isMeteredModel(modelKey))
        return false;
    const row = exports.MODEL_TIER_ACCESS[modelKey];
    return row[String(tier || "free").trim().toLowerCase()] === true;
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
        return Object.keys(exports.MODEL_TIER_ACCESS).map((modelKey) => {
            const allowed = tierAllowsModel(modelKey, tier);
            return {
                modelKey,
                allowed,
                used: usedByModel.get(modelKey) ?? 0,
                notEntitled: !allowed,
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
        const allowed = tierAllowsModel(modelKey, tier);
        const scope = (0, kafelot_service_1.normalizeUsageScope)(usageScope);
        const pool = this.db.getPool();
        const { rows } = await pool.query(`SELECT prompts_used FROM kafelot_prompt_usage
			 WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key = $4`, [accountId, currentMonthYear(), scope, modelKey]);
        const used = Number(rows[0]?.prompts_used) || 0;
        const allowance = { modelKey, allowed, used, notEntitled: !allowed };
        // One refusal reason now. "allowance exhausted" was the prompt quota, which no
        // longer exists; the RON balance is the budget and is enforced by billing.
        if (!allowed)
            return { allowed: false, reason: "model_not_in_plan", allowance };
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
