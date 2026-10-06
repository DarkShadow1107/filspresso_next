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
import { allowanceRon, monthKey, nextReset } from "./tier-allowance";

/**
 * Hard backstop for the funded wallet.
 *
 * The floor itself is per account (`account_balances.min_balance_ron`) so a customer can
 * choose never to spend past zero, or to allow a deliberate overdraft. This constant is
 * only the backstop for a row that has no usable floor of its own, and it is negative so
 * sub-ban nominal charges still register instead of bouncing every other request.
 */
export const MIN_BALANCE_RON = -0.5;

/**
 * The wallet is refilled to this much on the default card once it drops to its floor.
 *
 * The card is the one the Playground subscription used, so the customer is already on file
 * for it and no new instrument is introduced at the moment of spending.
 */
export const AUTO_REFILL_TARGET_RON = 30;

/**
 * Ceiling on the funded balance.
 *
 * A customer may pre-load any amount they like up to this, in one top-up or many. Capping
 * the balance rather than the top-up means a customer cannot end up holding a large balance
 * that a single mistake then spends.
 */
export const MAX_FUNDED_BALANCE_RON = 1000;

export type BalanceView = {
	accountId: number;
	balanceRon: number;
	lifetimeSpentRon: number;
	lifetimeTopupRon: number;
	/** False once the balance is at or below the account's own floor. */
	canGenerate: boolean;
	/** The floor this account actually uses: its own, or the hard backstop. */
	minBalanceRon: number;
	/** True when the floor came from the customer rather than the default. */
	minBalanceIsCustom: boolean;
};

export type AllowanceView = {
	accountId: number;
	/** UTC `YYYY-MM`. */
	month: string;
	tier: string;
	grantedRon: number;
	spentRon: number;
	remainingRon: number;
	/** ISO instant the allowance resets. */
	resetAt: string;
};

export type RecordUsageResult = {
	recorded: boolean;
	/** False when the same request_id had already been recorded. */
	duplicate?: boolean;
	costRon: number;
	/** Portion covered by this month's plan allowance. */
	allowanceAppliedRon: number;
	/** Portion taken from the card-funded wallet. */
	walletChargedRon: number;
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
		/** Plan tier, used to decide how much of the charge the allowance covers. */
		tier?: string;
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
							allowanceAppliedRon: 0,
							walletChargedRon: Number(existing.rows[0].cost_ron),
							balanceRon: Number(existing.rows[0].balance_after ?? 0),
							price,
						};
					}
				}

				// The plan allowance is spent before the wallet: it is the thing the
				// subscription bought, so using card money while included money remains
				// would be charging the customer twice for one request. Drawn inside this
				// transaction so the two pots cannot both be spent by concurrent requests.
				const allowanceApplied = cost > 0 ? await this.drawFromAllowanceTx(client, accountId, params.tier ?? "free", cost) : 0;
				const fromWallet = roundMoney(cost - allowanceApplied);

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
				const after = roundMoney(before - fromWallet);

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
					    cost_ron, allowance_applied_ron, metered, request_id, balance_after)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
					[
						accountId,
						modelKey,
						inputTokens,
						outputTokens,
						rates.inputPer1M,
						rates.outputPer1M,
						price.subscriberDiscountPercent,
						cost,
						allowanceApplied,
						metered,
						requestId,
						updated.rows[0].balance_ron,
					],
				);

				await client.query("COMMIT");
				return {
					recorded: true,
					costRon: cost,
					allowanceAppliedRon: allowanceApplied,
					walletChargedRon: fromWallet,
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
			 RETURNING balance_ron, lifetime_spent, lifetime_topup, min_balance_ron`,
			[accountId],
		);
		const row = result.rows[0];
		const balanceRon = Number(row.balance_ron);
		const stored = Number(row.min_balance_ron);
		// A NULL or absurd floor would either block everything or permit unlimited
		// overdraft, so it falls back to the backstop rather than being trusted.
		const floor = Number.isFinite(stored) ? stored : MIN_BALANCE_RON;
		return {
			accountId,
			balanceRon,
			lifetimeSpentRon: Number(row.lifetime_spent),
			lifetimeTopupRon: Number(row.lifetime_topup),
			canGenerate: balanceRon > floor,
			minBalanceRon: floor,
			minBalanceIsCustom: Number.isFinite(stored) && stored !== MIN_BALANCE_RON,
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

	/**
	 * The plan allowance for this month, created on first read.
	 *
	 * Granted lazily rather than by a cron, so a signup at 23:59 on the last day of the
	 * month still gets that month's allowance, and a missed scheduler run cannot silently
	 * cost a customer their budget for the month.
	 */
	async getAllowance(accountId: number, tier: string): Promise<AllowanceView> {
		const pool = this.db.getPool();
		const month = monthKey();
		const granted = allowanceRon(tier, true);
		const result = await pool.query(
			`INSERT INTO ai_monthly_allowance (account_id, month_key, tier, granted_ron)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (account_id, month_key) DO UPDATE SET account_id = EXCLUDED.account_id
			 RETURNING tier, granted_ron, spent_ron`,
			[accountId, month, String(tier || "free").slice(0, 32), granted],
		);
		const row = result.rows[0];
		const spent = Number(row.spent_ron);
		return {
			accountId,
			month,
			tier: row.tier,
			grantedRon: Number(row.granted_ron),
			spentRon: spent,
			remainingRon: roundMoney(Math.max(0, Number(row.granted_ron) - spent)),
			resetAt: nextReset().toISOString(),
		};
	}

	/**
	 * Draw `cost` from this month's allowance, returning how much it covered.
	 *
	 * The allowance is spent before the funded balance because it is the thing the
	 * subscription bought. `greatest()` caps the draw at the remaining allowance, so a cost
	 * larger than what is left spills over to the wallet instead of overdrawing the pot.
	 */
	async drawFromAllowance(accountId: number, tier: string, cost: number): Promise<number> {
		if (!(cost > 0)) return 0;
		const pool = this.db.getPool();
		const month = monthKey();
		const result = await pool.query(
			`INSERT INTO ai_monthly_allowance (account_id, month_key, tier, granted_ron, spent_ron)
			 VALUES ($1, $2, $3, $4, 0)
			 ON CONFLICT (account_id, month_key) DO UPDATE SET account_id = EXCLUDED.account_id
			 RETURNING granted_ron, spent_ron`,
			[accountId, month, String(tier || "free").slice(0, 32), allowanceRon(tier, true)],
		);
		const row = result.rows[0];
		const remaining = Math.max(0, Number(row.granted_ron) - Number(row.spent_ron));
		const drawn = roundMoney(Math.min(cost, remaining));
		if (drawn <= 0) return 0;
		await pool.query(
			`UPDATE ai_monthly_allowance
			    SET spent_ron = spent_ron + $3, updated_at = NOW()
			  WHERE account_id = $1 AND month_key = $2`,
			[accountId, month, drawn],
		);
		return drawn;
	}

	/**
	 * Allowance draw on an existing client, so it joins the caller's transaction.
	 *
	 * The public `drawFromAllowance` opens its own connection and would commit outside the
	 * usage transaction, which is how two concurrent requests could each see the full
	 * remaining allowance and jointly overspend it. This variant takes the caller's client.
	 */
	private async drawFromAllowanceTx(
		client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
		accountId: number,
		tier: string,
		cost: number,
	): Promise<number> {
		const month = monthKey();
		const inserted = await client.query(
			`INSERT INTO ai_monthly_allowance (account_id, month_key, tier, granted_ron, spent_ron)
			 VALUES ($1, $2, $3, $4, 0)
			 ON CONFLICT (account_id, month_key) DO UPDATE SET account_id = EXCLUDED.account_id
			 RETURNING granted_ron, spent_ron`,
			[accountId, month, String(tier || "free").slice(0, 32), allowanceRon(tier, true)],
		);
		const row = inserted.rows[0];
		const remaining = Math.max(0, Number(row.granted_ron) - Number(row.spent_ron));
		const drawn = roundMoney(Math.min(cost, remaining));
		if (drawn <= 0) return 0;
		// FOR UPDATE serialises concurrent draws for the same account in the same month.
		await client.query(
			`UPDATE ai_monthly_allowance
			    SET spent_ron = spent_ron + $3, updated_at = NOW()
			  WHERE account_id = $1 AND month_key = $2`,
			[accountId, month, drawn],
		);
		return drawn;
	}

	/** Set the customer's own floor. Negative values allow a deliberate overdraft. */
	async setMinBalance(accountId: number, floorRon: number): Promise<BalanceView> {
		const floor = roundMoney(Number(floorRon));
		if (!Number.isFinite(floor)) throw new Error(`invalid floor: ${floorRon}`);
		if (floor < MIN_BALANCE_RON) {
			// The backstop is not the customer's to move: without it a typo would authorise
			// unbounded overdraft on a wallet a card can drain automatically.
			throw new Error(`floor may not go below ${MIN_BALANCE_RON} RON`);
		}
		const pool = this.db.getPool();
		await pool.query(
			`INSERT INTO account_balances (account_id, min_balance_ron)
			 VALUES ($1, $2)
			 ON CONFLICT (account_id) DO UPDATE SET min_balance_ron = EXCLUDED.min_balance_ron`,
			[accountId, floor],
		);
		return this.getBalance(accountId);
	}

	/**
	 * Fund the wallet with card money, capped at MAX_FUNDED_BALANCE_RON.
	 *
	 * Returns what was actually added, which may be less than requested when the ceiling
	 * would be passed -- the alternative, silently taking the full amount, would leave the
	 * customer holding a balance they cannot explain.
	 */
	async fund(
		accountId: number,
		amountRon: number,
		cardId: number | null,
		source: "user" | "auto" = "user",
		idempotencyKey?: string | null,
	): Promise<{ addedRon: number; balanceRon: number; capped: boolean }> {
		const amount = roundMoney(Number(amountRon));
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new Error(`top-up amount must be positive, got ${amountRon}`);
		}
		const pool = this.db.getPool();
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const existing = idempotencyKey
				? (
						await client.query(
							`SELECT balance_after FROM billing_topups WHERE idempotency_key = $1 LIMIT 1`,
							[idempotencyKey],
						)
					).rows[0]
				: null;
			if (existing) {
				await client.query("ROLLBACK");
				return {
					addedRon: 0,
					balanceRon: Number(existing.balance_after ?? 0),
					capped: false,
				};
			}

			await client.query(
				`INSERT INTO account_balances (account_id) VALUES ($1)
				 ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id`,
				[accountId],
			);
			const before = Number(
				(await client.query(`SELECT balance_ron FROM account_balances WHERE account_id = $1`, [accountId]))
					.rows[0].balance_ron,
			);
			const room = Math.max(0, roundMoney(MAX_FUNDED_BALANCE_RON - before));
			const added = roundMoney(Math.min(amount, room));
			if (added <= 0) {
				await client.query("ROLLBACK");
				return { addedRon: 0, balanceRon: before, capped: true };
			}
			const after = roundMoney(before + added);
			await client.query(
				`UPDATE account_balances
				    SET balance_ron = $2, lifetime_topup = lifetime_topup + $3, updated_at = NOW()
				  WHERE account_id = $1`,
				[accountId, after, added],
			);
			await client.query(
				`INSERT INTO billing_topups (account_id, amount_ron, source, card_id, idempotency_key, balance_after)
				 VALUES ($1, $2, $3, $4, $5, $6)`,
				[accountId, added, source, cardId, idempotencyKey ?? null, after],
			);
			await client.query("COMMIT");
			return { addedRon: added, balanceRon: after, capped: added < amount };
		} catch (err) {
			await client.query("ROLLBACK");
			throw err;
		} finally {
			client.release();
		}
	}

	/** The default card, which is the one the Playground subscription used. */
	async defaultCardId(accountId: number): Promise<number | null> {
		const pool = this.db.getPool();
		const result = await pool.query(
			`SELECT id FROM user_cards WHERE account_id = $1 ORDER BY is_default DESC, id ASC LIMIT 1`,
			[accountId],
		);
		return result.rows[0]?.id ?? null;
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
