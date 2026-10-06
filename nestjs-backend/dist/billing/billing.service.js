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
var BillingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = exports.InsufficientBalanceError = exports.MAX_FUNDED_BALANCE_RON = exports.AUTO_REFILL_TARGET_RON = exports.MIN_BALANCE_RON = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const model_pricing_1 = require("./model-pricing");
const tier_allowance_1 = require("./tier-allowance");
/**
 * Hard backstop for the funded wallet.
 *
 * The floor itself is per account (`account_balances.min_balance_ron`) so a customer can
 * choose never to spend past zero, or to allow a deliberate overdraft. This constant is
 * only the backstop for a row that has no usable floor of its own, and it is negative so
 * sub-ban nominal charges still register instead of bouncing every other request.
 */
exports.MIN_BALANCE_RON = -0.5;
/**
 * The wallet is refilled to this much on the default card once it drops to its floor.
 *
 * The card is the one the Playground subscription used, so the customer is already on file
 * for it and no new instrument is introduced at the moment of spending.
 */
exports.AUTO_REFILL_TARGET_RON = 30;
/**
 * Ceiling on the funded balance.
 *
 * A customer may pre-load any amount they like up to this, in one top-up or many. Capping
 * the balance rather than the top-up means a customer cannot end up holding a large balance
 * that a single mistake then spends.
 */
exports.MAX_FUNDED_BALANCE_RON = 1000;
/** Why a request was refused, so the caller can tell the customer something specific. */
class InsufficientBalanceError extends Error {
    balanceRon;
    requiredRon;
    constructor(balanceRon, requiredRon) {
        super(`balance ${balanceRon} RON is at or below the ${exports.MIN_BALANCE_RON} RON floor`);
        this.balanceRon = balanceRon;
        this.requiredRon = requiredRon;
        this.name = "InsufficientBalanceError";
    }
}
exports.InsufficientBalanceError = InsufficientBalanceError;
/**
 * Token metering and the RON balance.
 *
 * Spend is derived from an immutable `ai_token_usage` log and the balance is a cached
 * total, rather than the balance being authoritative on its own. That is the same
 * reasoning as re-pricing an order from the catalogue instead of the request body: the
 * thing a customer is shown has to be reconstructible from records.
 */
let BillingService = BillingService_1 = class BillingService {
    db;
    logger = new common_1.Logger(BillingService_1.name);
    constructor(db) {
        this.db = db;
    }
    /**
     * Record one generation and debit its cost. Idempotent per `requestId`.
     *
     * A single transaction, and the debit is a plain arithmetic UPDATE rather than
     * read-modify-write in application code: two concurrent requests must not both read
     * the same balance and each write balance-minus-cost, which silently loses one charge.
     */
    async recordUsage(params) {
        const { accountId, modelKey, subscriber } = params;
        const requestId = params.requestId ? String(params.requestId).slice(0, 128) : null;
        const price = (0, model_pricing_1.resolveTokenPrice)(modelKey, subscriber);
        const rates = (0, model_pricing_1.effectiveRates)(price);
        const inputTokens = clampTokens(params.usage?.inputTokens);
        const outputTokens = clampTokens(params.usage?.outputTokens);
        // `metered` is the honest signal: a fallback answer or an upstream that omitted
        // usage must not look like a priced request.
        const metered = price.known && inputTokens + outputTokens > 0;
        const cost = metered ? (0, model_pricing_1.costRon)(modelKey, { inputTokens, outputTokens }, subscriber) : 0;
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            try {
                if (requestId) {
                    const existing = await client.query(`SELECT cost_ron, balance_after FROM ai_token_usage
						  WHERE request_id = $1 LIMIT 1`, [requestId]);
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
                const fromWallet = (0, model_pricing_1.roundMoney)(cost - allowanceApplied);
                // Lock the balance row for the duration so the read-modify-write below is
                // serialised across concurrent requests for the same account.
                const bal = await client.query(`INSERT INTO account_balances (account_id, balance_ron)
					 VALUES ($1, 0)
					 ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id
					 RETURNING balance_ron, lifetime_spent`, [accountId]);
                const before = Number(bal.rows[0].balance_ron);
                const after = (0, model_pricing_1.roundMoney)(before - fromWallet);
                const updated = await client.query(`UPDATE account_balances
					    SET balance_ron = $2,
					        lifetime_spent = lifetime_spent + $3,
					        updated_at = NOW()
					  WHERE account_id = $1
					  RETURNING balance_ron`, [accountId, after, cost]);
                await client.query(`INSERT INTO ai_token_usage
					   (account_id, model_key, input_tokens, output_tokens,
					    input_price_per1m, output_price_per1m, subscriber_discount,
					    cost_ron, allowance_applied_ron, metered, request_id, balance_after)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [
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
                ]);
                await client.query("COMMIT");
                return {
                    recorded: true,
                    costRon: cost,
                    allowanceAppliedRon: allowanceApplied,
                    walletChargedRon: fromWallet,
                    balanceRon: Number(updated.rows[0].balance_ron),
                    price,
                };
            }
            catch (err) {
                await client.query("ROLLBACK");
                throw err;
            }
        }
        finally {
            client.release();
        }
    }
    async getBalance(accountId) {
        const pool = this.db.getPool();
        const result = await pool.query(`INSERT INTO account_balances (account_id)
			 VALUES ($1)
			 ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id
			 RETURNING balance_ron, lifetime_spent, lifetime_topup, min_balance_ron`, [accountId]);
        const row = result.rows[0];
        const balanceRon = Number(row.balance_ron);
        const stored = Number(row.min_balance_ron);
        // A NULL or absurd floor would either block everything or permit unlimited
        // overdraft, so it falls back to the backstop rather than being trusted.
        const floor = Number.isFinite(stored) ? stored : exports.MIN_BALANCE_RON;
        return {
            accountId,
            balanceRon,
            lifetimeSpentRon: Number(row.lifetime_spent),
            lifetimeTopupRon: Number(row.lifetime_topup),
            canGenerate: balanceRon > floor,
            minBalanceRon: floor,
            minBalanceIsCustom: Number.isFinite(stored) && stored !== exports.MIN_BALANCE_RON,
        };
    }
    /**
     * Throw if the account may not start another generation.
     *
     * Checked *before* the model runs, not after: refusing afterwards means serving a
     * request and then complaining about it. `requiredRon` is the expected cost of the
     * request being attempted, used only for the message.
     */
    async assertCanGenerate(accountId, modelKey, subscriber) {
        const balance = await this.getBalance(accountId);
        if (balance.canGenerate)
            return;
        const estimate = (0, model_pricing_1.costRon)(modelKey, { inputTokens: 1000, outputTokens: 1000 }, subscriber);
        throw new InsufficientBalanceError(balance.balanceRon, estimate);
    }
    /**
     * The plan allowance for this month, created on first read.
     *
     * Granted lazily rather than by a cron, so a signup at 23:59 on the last day of the
     * month still gets that month's allowance, and a missed scheduler run cannot silently
     * cost a customer their budget for the month.
     */
    async getAllowance(accountId, tier) {
        const pool = this.db.getPool();
        const month = (0, tier_allowance_1.monthKey)();
        const granted = (0, tier_allowance_1.allowanceRon)(tier, true);
        const result = await pool.query(`INSERT INTO ai_monthly_allowance (account_id, month_key, tier, granted_ron)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (account_id, month_key) DO UPDATE SET account_id = EXCLUDED.account_id
			 RETURNING tier, granted_ron, spent_ron`, [accountId, month, String(tier || "free").slice(0, 32), granted]);
        const row = result.rows[0];
        const spent = Number(row.spent_ron);
        return {
            accountId,
            month,
            tier: row.tier,
            grantedRon: Number(row.granted_ron),
            spentRon: spent,
            remainingRon: (0, model_pricing_1.roundMoney)(Math.max(0, Number(row.granted_ron) - spent)),
            resetAt: (0, tier_allowance_1.nextReset)().toISOString(),
        };
    }
    /**
     * Draw `cost` from this month's allowance, returning how much it covered.
     *
     * The allowance is spent before the funded balance because it is the thing the
     * subscription bought. `greatest()` caps the draw at the remaining allowance, so a cost
     * larger than what is left spills over to the wallet instead of overdrawing the pot.
     */
    async drawFromAllowance(accountId, tier, cost) {
        if (!(cost > 0))
            return 0;
        const pool = this.db.getPool();
        const month = (0, tier_allowance_1.monthKey)();
        const result = await pool.query(`INSERT INTO ai_monthly_allowance (account_id, month_key, tier, granted_ron, spent_ron)
			 VALUES ($1, $2, $3, $4, 0)
			 ON CONFLICT (account_id, month_key) DO UPDATE SET account_id = EXCLUDED.account_id
			 RETURNING granted_ron, spent_ron`, [accountId, month, String(tier || "free").slice(0, 32), (0, tier_allowance_1.allowanceRon)(tier, true)]);
        const row = result.rows[0];
        const remaining = Math.max(0, Number(row.granted_ron) - Number(row.spent_ron));
        const drawn = (0, model_pricing_1.roundMoney)(Math.min(cost, remaining));
        if (drawn <= 0)
            return 0;
        await pool.query(`UPDATE ai_monthly_allowance
			    SET spent_ron = spent_ron + $3, updated_at = NOW()
			  WHERE account_id = $1 AND month_key = $2`, [accountId, month, drawn]);
        return drawn;
    }
    /**
     * Allowance draw on an existing client, so it joins the caller's transaction.
     *
     * The public `drawFromAllowance` opens its own connection and would commit outside the
     * usage transaction, which is how two concurrent requests could each see the full
     * remaining allowance and jointly overspend it. This variant takes the caller's client.
     */
    async drawFromAllowanceTx(client, accountId, tier, cost) {
        const month = (0, tier_allowance_1.monthKey)();
        const inserted = await client.query(`INSERT INTO ai_monthly_allowance (account_id, month_key, tier, granted_ron, spent_ron)
			 VALUES ($1, $2, $3, $4, 0)
			 ON CONFLICT (account_id, month_key) DO UPDATE SET account_id = EXCLUDED.account_id
			 RETURNING granted_ron, spent_ron`, [accountId, month, String(tier || "free").slice(0, 32), (0, tier_allowance_1.allowanceRon)(tier, true)]);
        const row = inserted.rows[0];
        const remaining = Math.max(0, Number(row.granted_ron) - Number(row.spent_ron));
        const drawn = (0, model_pricing_1.roundMoney)(Math.min(cost, remaining));
        if (drawn <= 0)
            return 0;
        // FOR UPDATE serialises concurrent draws for the same account in the same month.
        await client.query(`UPDATE ai_monthly_allowance
			    SET spent_ron = spent_ron + $3, updated_at = NOW()
			  WHERE account_id = $1 AND month_key = $2`, [accountId, month, drawn]);
        return drawn;
    }
    /** Set the customer's own floor. Negative values allow a deliberate overdraft. */
    async setMinBalance(accountId, floorRon) {
        const floor = (0, model_pricing_1.roundMoney)(Number(floorRon));
        if (!Number.isFinite(floor))
            throw new Error(`invalid floor: ${floorRon}`);
        if (floor < exports.MIN_BALANCE_RON) {
            // The backstop is not the customer's to move: without it a typo would authorise
            // unbounded overdraft on a wallet a card can drain automatically.
            throw new Error(`floor may not go below ${exports.MIN_BALANCE_RON} RON`);
        }
        const pool = this.db.getPool();
        await pool.query(`INSERT INTO account_balances (account_id, min_balance_ron)
			 VALUES ($1, $2)
			 ON CONFLICT (account_id) DO UPDATE SET min_balance_ron = EXCLUDED.min_balance_ron`, [accountId, floor]);
        return this.getBalance(accountId);
    }
    /**
     * Fund the wallet with card money, capped at MAX_FUNDED_BALANCE_RON.
     *
     * Returns what was actually added, which may be less than requested when the ceiling
     * would be passed -- the alternative, silently taking the full amount, would leave the
     * customer holding a balance they cannot explain.
     */
    async fund(accountId, amountRon, cardId, source = "user", idempotencyKey) {
        const amount = (0, model_pricing_1.roundMoney)(Number(amountRon));
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error(`top-up amount must be positive, got ${amountRon}`);
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const existing = idempotencyKey
                ? (await client.query(`SELECT balance_after FROM billing_topups WHERE idempotency_key = $1 LIMIT 1`, [idempotencyKey])).rows[0]
                : null;
            if (existing) {
                await client.query("ROLLBACK");
                return {
                    addedRon: 0,
                    balanceRon: Number(existing.balance_after ?? 0),
                    capped: false,
                };
            }
            await client.query(`INSERT INTO account_balances (account_id) VALUES ($1)
				 ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id`, [accountId]);
            const before = Number((await client.query(`SELECT balance_ron FROM account_balances WHERE account_id = $1`, [accountId]))
                .rows[0].balance_ron);
            const room = Math.max(0, (0, model_pricing_1.roundMoney)(exports.MAX_FUNDED_BALANCE_RON - before));
            const added = (0, model_pricing_1.roundMoney)(Math.min(amount, room));
            if (added <= 0) {
                await client.query("ROLLBACK");
                return { addedRon: 0, balanceRon: before, capped: true };
            }
            const after = (0, model_pricing_1.roundMoney)(before + added);
            await client.query(`UPDATE account_balances
				    SET balance_ron = $2, lifetime_topup = lifetime_topup + $3, updated_at = NOW()
				  WHERE account_id = $1`, [accountId, after, added]);
            await client.query(`INSERT INTO billing_topups (account_id, amount_ron, source, card_id, idempotency_key, balance_after)
				 VALUES ($1, $2, $3, $4, $5, $6)`, [accountId, added, source, cardId, idempotencyKey ?? null, after]);
            await client.query("COMMIT");
            return { addedRon: added, balanceRon: after, capped: added < amount };
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }
    /** The default card, which is the one the Playground subscription used. */
    async defaultCardId(accountId) {
        const pool = this.db.getPool();
        const result = await pool.query(`SELECT id FROM user_cards WHERE account_id = $1 ORDER BY is_default DESC, id ASC LIMIT 1`, [accountId]);
        return result.rows[0]?.id ?? null;
    }
    /** Credit a balance. `orderId` ties the top-up to the order that paid for it. */
    async topUp(accountId, amountRon, orderId) {
        const amount = (0, model_pricing_1.roundMoney)(Number(amountRon));
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error(`top-up amount must be positive, got ${amountRon}`);
        }
        const pool = this.db.getPool();
        await pool.query(`UPDATE account_balances
			    SET balance_ron = balance_ron + $2,
			        lifetime_topup = lifetime_topup + $2,
			        updated_at = NOW()
			  WHERE account_id = $1`, [accountId, amount]);
        if (orderId) {
            this.logger.log(`top-up ${amount} RON for account ${accountId} from order ${orderId}`);
        }
        return this.getBalance(accountId);
    }
    /** Recent spend for the account view. */
    async recentUsage(accountId, limit = 20) {
        const capped = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const pool = this.db.getPool();
        const result = await pool.query(`SELECT model_key, input_tokens, output_tokens, cost_ron, metered, created_at
			   FROM ai_token_usage
			  WHERE account_id = $1
			  ORDER BY created_at DESC, id DESC
			  LIMIT $2`, [accountId, capped]);
        return result.rows.map((r) => ({
            modelKey: r.model_key,
            inputTokens: Number(r.input_tokens),
            outputTokens: Number(r.output_tokens),
            costRon: Number(r.cost_ron),
            metered: Boolean(r.metered),
            createdAt: r.created_at,
        }));
    }
};
exports.BillingService = BillingService;
exports.BillingService = BillingService = BillingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], BillingService);
function clampTokens(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    return Math.floor(n);
}
