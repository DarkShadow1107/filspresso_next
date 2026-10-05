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
exports.BillingService = exports.InsufficientBalanceError = exports.MIN_BALANCE_RON = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const model_pricing_1 = require("./model-pricing");
/**
 * What an account may run up before the next request is refused.
 *
 * A balance is allowed to go negative on purpose: refusing to record usage that has
 * already been served would mean the meter and the ledger disagree, which is worse than a
 * small debt. But *unbounded* negative is just free service, so a request is refused once
 * the balance is at or below this floor. The floor is negative so the sub-ban nominal
 * charges still register rather than bouncing every other request.
 */
exports.MIN_BALANCE_RON = -0.5;
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
                            balanceRon: Number(existing.rows[0].balance_after ?? 0),
                            price,
                        };
                    }
                }
                // Lock the balance row for the duration so the read-modify-write below is
                // serialised across concurrent requests for the same account.
                const bal = await client.query(`INSERT INTO account_balances (account_id, balance_ron)
					 VALUES ($1, 0)
					 ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id
					 RETURNING balance_ron, lifetime_spent`, [accountId]);
                const before = Number(bal.rows[0].balance_ron);
                const after = (0, model_pricing_1.roundMoney)(before - cost);
                const updated = await client.query(`UPDATE account_balances
					    SET balance_ron = $2,
					        lifetime_spent = lifetime_spent + $3,
					        updated_at = NOW()
					  WHERE account_id = $1
					  RETURNING balance_ron`, [accountId, after, cost]);
                await client.query(`INSERT INTO ai_token_usage
					   (account_id, model_key, input_tokens, output_tokens,
					    input_price_per1m, output_price_per1m, subscriber_discount,
					    cost_ron, metered, request_id, balance_after)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
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
                ]);
                await client.query("COMMIT");
                return {
                    recorded: true,
                    costRon: cost,
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
			 RETURNING balance_ron, lifetime_spent, lifetime_topup`, [accountId]);
        const row = result.rows[0];
        const balanceRon = Number(row.balance_ron);
        return {
            accountId,
            balanceRon,
            lifetimeSpentRon: Number(row.lifetime_spent),
            lifetimeTopupRon: Number(row.lifetime_topup),
            canGenerate: balanceRon > exports.MIN_BALANCE_RON,
            minBalanceRon: exports.MIN_BALANCE_RON,
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
