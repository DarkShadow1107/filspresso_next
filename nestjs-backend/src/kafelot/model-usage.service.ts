import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service";
import { USAGE_SCOPES, normalizeUsageScope } from "./kafelot.service";

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
export const MODEL_TIER_ACCESS: Record<string, Record<string, boolean>> = {
	lfm2_5_230m_q4_k_m:           { free: true,  basic: true, plus: true,  pro: true,  max: true, ultimate: true },
	lfm2_5_350m_q8_0:             {              basic: true, plus: true,  pro: true,  max: true, ultimate: true },
	lfm2_5_1_2b_instruct_q4_k_m:  {                            plus: true,  pro: true,  max: true, ultimate: true },
	lfm2_5_1_2b_thinking_q4_k_m:  {                                      pro: true,  max: true, ultimate: true },
	lfm2_5_2_6b_q4_0:             {                                                  max: true, ultimate: true },
	lfm2_5_8b_a1b_q4_k_m:         {                                                                ultimate: true },
	lfm2_5_vl_450m_q4_k_m:        {                            plus: true,  pro: true,  max: true, ultimate: true },
	lfm2_5_vl_3b_q4_k_m:          {                                                  max: true, ultimate: true },
	lfm2_5_audio_1_5b_q4_0:       {                                                                ultimate: true },
};

/** True when the model is one we meter. Unknown keys are rejected, not ignored. */
export function isMeteredModel(modelKey: string): boolean {
	return Object.prototype.hasOwnProperty.call(MODEL_TIER_ACCESS, modelKey);
}

/**
 * Whether this plan may use this model at all.
 *
 * Membership is tested explicitly. An unrecognised tier returns false, because defaulting
 * it to true would hand a new or misspelled plan every model in the lineup.
 */
export function tierAllowsModel(modelKey: string, tier: string): boolean {
	if (!isMeteredModel(modelKey)) return false;
	const row = MODEL_TIER_ACCESS[modelKey];
	return row[String(tier || "free").trim().toLowerCase()] === true;
}

export type ModelAllowance = {
	modelKey: string;
	/** Whether this plan includes the model. The only gate left on model choice. */
	allowed: boolean;
	/** Prompts sent this month. Retained as a usage figure, not a limit. */
	used: number;
	/** Alias for `!allowed`, kept so existing callers read naturally. */
	notEntitled: boolean;
};

@Injectable()
export class ModelUsageService {
	constructor(private readonly db: DatabaseService) {}

	/**
	 * Current per-model usage for every metered model on a plan.
	 *
	 * Returned by the status endpoint so the client can grey out a model whose
	 * allowance is spent rather than letting the user discover it via a 429.
	 */
	async allowancesForTier(accountId: number, tier: string, usageScope: string): Promise<ModelAllowance[]> {
		const pool = this.db.getPool();
		const scope = normalizeUsageScope(usageScope);
		const { rows } = await pool.query(
			`SELECT model_key, prompts_used FROM kafelot_prompt_usage
			 WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key <> ''`,
			[accountId, currentMonthYear(), scope],
		);
		const usedByModel = new Map<string, number>(
			(rows as Array<{ model_key: string; prompts_used: number }>).map((r) => [
				String(r.model_key),
				Number(r.prompts_used) || 0,
			]),
		);
		return Object.keys(MODEL_TIER_ACCESS).map((modelKey) => {
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
	async checkModelAllowance(
		accountId: number,
		tier: string,
		usageScope: string,
		modelKey: string,
	): Promise<{ allowed: boolean; reason?: string; allowance: ModelAllowance }> {
		const allowed = tierAllowsModel(modelKey, tier);
		const scope = normalizeUsageScope(usageScope);
		const pool = this.db.getPool();
		const { rows } = await pool.query(
			`SELECT prompts_used FROM kafelot_prompt_usage
			 WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key = $4`,
			[accountId, currentMonthYear(), scope, modelKey],
		);
		const used = Number(rows[0]?.prompts_used) || 0;
		const allowance: ModelAllowance = { modelKey, allowed, used, notEntitled: !allowed };
		// One refusal reason now. "allowance exhausted" was the prompt quota, which no
		// longer exists; the RON balance is the budget and is enforced by billing.
		if (!allowed) return { allowed: false, reason: "model_not_in_plan", allowance };
		return { allowed: true, allowance };
	}

	/** Increment a model's sub-count. Called inside the same transaction as the scope total. */
	async consumeModel(client: any, accountId: number, usageScope: string, modelKey: string): Promise<void> {
		await client.query(
			`INSERT INTO kafelot_prompt_usage
			   (account_id, month_year, usage_scope, model_key, prompts_used, prompts_limit, subscription_tier, reset_date)
			 VALUES ($1, $2, $3, $4, 0, 0, '', $5)
			 ON CONFLICT (account_id, month_year, usage_scope, model_key) DO NOTHING`,
			[accountId, currentMonthYear(), normalizeUsageScope(usageScope), modelKey, nextMonthReset()],
		);
		await client.query(
			`UPDATE kafelot_prompt_usage SET prompts_used = prompts_used + 1, updated_at = CURRENT_TIMESTAMP
			 WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3 AND model_key = $4`,
			[accountId, currentMonthYear(), normalizeUsageScope(usageScope), modelKey],
		);
	}
}

export function currentMonthYear(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function nextMonthReset(): string {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
}

export { USAGE_SCOPES };