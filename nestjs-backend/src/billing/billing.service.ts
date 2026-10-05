import { Injectable, Logger } from "@nestjs/common";

import { DatabaseService } from "../database/database.service";
import {
	costRon,
	effectiveRates,
	resolveTokenPrice,
	roundMoney,
	type ResolvedTokenPrice,
	type TokenUsage,
} from "./model-pricing";

/**
 * What an account may run up before the next request is refused.
 *
 * A balance is allowed to go negative on purpose: refusing to record usage that has
 * already been served would mean the meter and the ledger disagree, which is worse than a
 * small debt. But *unbounded* negative is just free service, so a request is refused once
 * the balance is at or below this floor. The floor is negative so the sub-ban nominal
 * charges still register rather than bouncing every other request.
 */
export const MIN_BALANCE_RON = -0.5;

export type BalanceView = {
	accountId: number;
	balanceRon: number;
	lifetimeSpentRon: number;
	lifetimeTopupRon: number;
	/** False once the balance is at or below MIN_BALANCE_RON. */
	canGenerate: boolean;
	minBalanceRon: number;
};

export type RecordUsageResult = {
	recorded: boolean;
	/** False when the same request_id had already been recorded. */
	duplicate?: boolean;
	costRon: number;
	balanceRon: number;
	price: ResolvedTokenPrice;
};

/** Why a request was refused, so the caller can tell the customer something specific. */
export class InsufficientBalanceError extends Error {
	constructor(
		readonly balanceRon: number,
		readonly requiredRon: number,
	) {
		super(`balance ${balanceRon} RON is at or below the ${MIN_BALANCE_RON} RON floor`);
		this.name = "InsufficientBalanceError";
	}
}

/**
 * Token metering and the RON balance.
 *
 * Spend is derived from an immutable `ai_token_usage` log and the balance is a cached
 * total, rather than the balance being authoritative on its own. That is the same
 * reasoning as re-pricing an order from the catalogue instead of the request body: the
 * thing a customer is shown has to be reconstructible from records.
 */
@Injectable()
export class BillingService {
	private readonly logger = new Logger(BillingService.name);

	constructor(private readonly db: DatabaseService) {}

	/**
	 * Record one generation and debit its cost. Idempotent per `requestId`.
	 *
	 * A single transaction, and the debit is a plain arithmetic UPDATE rather than
	 * read-modify-write in application code: two concurrent requests must not both read
	 * the same balance and each write balance-minus-cost, which silently loses one charge.
	 */
	async recordUsage(params: {
		accountId: number;
		modelKey: string;
		usage: TokenUsage;
		subscriber: boolean;
		requestId?: string | null;
	}): Promise<RecordUsageResult> {
		const { accountId, modelKey, subscriber } = params;
		const requestId = params.requestId ? String(params.requestId).slice(0, 128) : null;
		const price = resolveTokenPrice(modelKey, subscriber);
		const rates = effectiveRates(price);
		const inputTokens = clampTokens(params.usage?.inputTokens);
		const outputTokens = clampTokens(params.usage?.outputTokens);
		// `metered` is the honest signal: a fallback answer or an upstream that omitted
		// usage must not look like a priced request.
		const metered = price.known && inputTokens + outputTokens > 0;
		const cost = metered ? costRon(modelKey, { inputTokens, outputTokens }, subscriber) : 0;

		const pool = this.db.getPool();
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			try {
				if (requestId) {
					const existing = await client.query(
						`SELECT cost_ron, balance_after FROM ai_token_usage
						  WHERE request_id = $1 LIMIT 1`,
						[requestId],
					);
					if (existing.rows.length > 0) {
						await client.query("ROLLBACK");
						return {
							recorded: false,
							duplicate: true,
							costRon: Number(existing.rows[0].cost_ron),
							balanceRon: Number(existing.rows[0].balance_after ?? 0),
							price,
						};
					}
				}

				// Lock the balance row for the duration so the read-modify-write below is
				// serialised across concurrent requests for the same account.
				const bal = await client.query(
					`INSERT INTO account_balances (account_id, balance_ron)
					 VALUES ($1, 0)
					 ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id
					 RETURNING balance_ron, lifetime_spent`,
					[accountId],
				);
				const before = Number(bal.rows[0].balance_ron);
				const after = roundMoney(before - cost);

				const updated = await client.query(
					`UPDATE account_balances
					    SET balance_ron = $2,
					        lifetime_spent = lifetime_spent + $3,
					        updated_at = NOW()
					  WHERE account_id = $1
					  RETURNING balance_ron`,
					[accountId, after, cost],
				);

				await client.query(
					`INSERT INTO ai_token_usage
					   (account_id, model_key, input_tokens, output_tokens,
					    input_price_per1m, output_price_per1m, subscriber_discount,
					    cost_ron, metered, request_id, balance_after)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
					[
						accountId,
						modelKey,
						inputTokens,
						outputTokens,
						rates.inputPer1M,
						rates.outputPer1M,
						price.subscriberDiscountPercent,
						cost,
						metered,
						requestId,
						updated.rows[0].balance_ron,
					],
				);

				await client.query("COMMIT");
				return {
					recorded: true,
					costRon: cost,
					balanceRon: Number(updated.rows[0].balance_ron),
					price,
				};
			} catch (err) {
				await client.query("ROLLBACK");
				throw err;
			}
		} finally {
			client.release();
		}
	}

	async getBalance(accountId: number): Promise<BalanceView> {
		const pool = this.db.getPool();
		const result = await pool.query(
			`INSERT INTO account_balances (account_id)
			 VALUES ($1)
			 ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id
			 RETURNING balance_ron, lifetime_spent, lifetime_topup`,
			[accountId],
		);
		const row = result.rows[0];
		const balanceRon = Number(row.balance_ron);
		return {
			accountId,
			balanceRon,
			lifetimeSpentRon: Number(row.lifetime_spent),
			lifetimeTopupRon: Number(row.lifetime_topup),
			canGenerate: balanceRon > MIN_BALANCE_RON,
			minBalanceRon: MIN_BALANCE_RON,
		};
	}

	/**
	 * Throw if the account may not start another generation.
	 *
	 * Checked *before* the model runs, not after: refusing afterwards means serving a
	 * request and then complaining about it. `requiredRon` is the expected cost of the
	 * request being attempted, used only for the message.
	 */
	async assertCanGenerate(accountId: number, modelKey: string, subscriber: boolean): Promise<void> {
		const balance = await this.getBalance(accountId);
		if (balance.canGenerate) return;
		const estimate = costRon(modelKey, { inputTokens: 1000, outputTokens: 1000 }, subscriber);
		throw new InsufficientBalanceError(balance.balanceRon, estimate);
	}

	/** Credit a balance. `orderId` ties the top-up to the order that paid for it. */
	async topUp(accountId: number, amountRon: number, orderId?: number | null): Promise<BalanceView> {
		const amount = roundMoney(Number(amountRon));
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new Error(`top-up amount must be positive, got ${amountRon}`);
		}
		const pool = this.db.getPool();
		await pool.query(
			`UPDATE account_balances
			    SET balance_ron = balance_ron + $2,
			        lifetime_topup = lifetime_topup + $2,
			        updated_at = NOW()
			  WHERE account_id = $1`,
			[accountId, amount],
		);
		if (orderId) {
			this.logger.log(`top-up ${amount} RON for account ${accountId} from order ${orderId}`);
		}
		return this.getBalance(accountId);
	}

	/** Recent spend for the account view. */
	async recentUsage(accountId: number, limit = 20): Promise<Array<Record<string, unknown>>> {
		const capped = Math.min(Math.max(Number(limit) || 20, 1), 100);
		const pool = this.db.getPool();
		const result = await pool.query(
			`SELECT model_key, input_tokens, output_tokens, cost_ron, metered, created_at
			   FROM ai_token_usage
			  WHERE account_id = $1
			  ORDER BY created_at DESC, id DESC
			  LIMIT $2`,
			[accountId, capped],
		);
		return result.rows.map((r) => ({
			modelKey: r.model_key,
			inputTokens: Number(r.input_tokens),
			outputTokens: Number(r.output_tokens),
			costRon: Number(r.cost_ron),
			metered: Boolean(r.metered),
			createdAt: r.created_at,
		}));
	}
}

function clampTokens(value: unknown): number {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.floor(n);
}
