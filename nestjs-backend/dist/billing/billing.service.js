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
        let result;
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
					 RETURNING balance_ron, lifetime_spent, min_balance_ron`, [accountId]);
                const before = Number(bal.rows[0].balance_ron);
                // The floor is enforced here, not only in canGenerate.
                //
                // canGenerate stops the *next* request, which is not the same thing as
                // bounding this one. A single generation can cost more than the whole
                // remaining wallet: a 150 RON request against a 0 RON balance used to take
                // the balance to -150, and since nothing capped it, the debt grew with every
                // request. The floor exists precisely to stop that, so it is applied to the
                // draw, and whatever it cannot cover is reported instead of charged.
                const storedFloor = Number(bal.rows[0].min_balance_ron);
                const floor = Number.isFinite(storedFloor) ? storedFloor : exports.MIN_BALANCE_RON;
                const drawable = Math.max(0, before - floor);
                const charged = (0, model_pricing_1.roundMoney)(Math.min(fromWallet, drawable));
                const uncovered = (0, model_pricing_1.roundMoney)(fromWallet - charged);
                const after = (0, model_pricing_1.roundMoney)(before - charged);
                const updated = await client.query(`UPDATE account_balances
					    SET balance_ron = $2,
					        lifetime_spent = lifetime_spent + $3,
					        updated_at = NOW()
					  WHERE account_id = $1
					  RETURNING balance_ron`, [accountId, after, cost]);
                await client.query(`INSERT INTO ai_token_usage
					   (account_id, model_key, input_tokens, output_tokens,
					    input_price_per1m, output_price_per1m, subscriber_discount,
					    cost_ron, allowance_applied_ron, uncovered_ron, metered, request_id, balance_after)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [
                    accountId,
                    modelKey,
                    inputTokens,
                    outputTokens,
                    rates.inputPer1M,
                    rates.outputPer1M,
                    price.subscriberDiscountPercent,
                    cost,
                    allowanceApplied,
                    uncovered,
                    metered,
                    requestId,
                    updated.rows[0].balance_ron,
                ]);
                await client.query("COMMIT");
                result = {
                    recorded: true,
                    costRon: cost,
                    allowanceAppliedRon: allowanceApplied,
                    walletChargedRon: charged,
                    uncoveredRon: uncovered,
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
        // Only now that the charge is committed and the row lock is released.
        //
        // A refill inside the transaction would write a second row while holding the first,
        // and a top-up that failed would roll back a charge for work already done: the
        // customer would be billed nothing and the usage row would vanish with it. The
        // refill is a separate decision made after the fact, so it gets its own transaction.
        await this.maybeAutoRefill(accountId);
        return result;
    }
    /**
     * Refill the wallet to the target if it has fallen to its floor.
     *
     * `autoRefillTargetRon` has been reported to every customer by /api/billing/balance
     * since the wallet shipped, and nothing ever acted on it. This is the thing that acts on
     * it.
     *
     * Refill is deliberately *not* once per day. That was the earlier design, and it is
     * wrong for a prepaid meter: a customer who burns through 30 RON in an afternoon would
     * be cut off until midnight. The honest rule is the one the name implies -- refill
     * whenever the balance reaches the floor -- and the duplication worry is answered by the
     * floor check inside `fund()` under a row lock, not by rationing the customer.
     */
    async maybeAutoRefill(accountId) {
        try {
            const balance = await this.getBalance(accountId);
            if (balance.autoRefill.lastTopUpAt) {
                const last = Date.parse(balance.autoRefill.lastTopUpAt);
                const minutesSince = (Date.now() - last) / 60_000;
                // A circuit breaker, not the rule. It only engages when a wallet is emptying
                // far faster than any single top-up can explain, where the customer is far
                // better served by a 402 than by a card charged dozens of times in a loop.
                if (minutesSince < 1)
                    return;
            }
            const cardId = await this.defaultCardId(accountId);
            // No card is not an error. Most accounts never fund one, and throwing here would
            // turn an ordinary generation into a 500 for every subscriber without a card.
            if (cardId == null)
                return;
            await this.fund(accountId, exports.AUTO_REFILL_TARGET_RON, cardId, "auto", null, 
            // The atomic guard. Without it this method is a read-then-write race.
            true);
        }
        catch (err) {
            // A refill that fails must not fail the charge that triggered it. The customer
            // was billed correctly; the top-up is a separate promise and is visible as
            // missing on /balance rather than as a broken request.
            console.warn(`[billing] auto-refill skipped for account ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
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
        // Read after the balance row is guaranteed to exist. Two small queries rather than a
        // join, because the row this depends on may have been created by the line above.
        const [hasCard, lastAuto] = await Promise.all([
            this.defaultCardId(accountId),
            pool.query(`SELECT created_at, amount_ron FROM billing_topups
				  WHERE account_id = $1 AND source = 'auto'
				  ORDER BY created_at DESC LIMIT 1`, [accountId]),
        ]);
        const lastRow = lastAuto.rows[0];
        // Enabled means "this would run if the balance fell to its floor", not "it has run".
        // Without a default card there is nothing to charge, so the honest answer is no --
        // and the reason says so, rather than leaving a customer to discover it by hitting a
        // floor and watching nothing happen.
        const enabled = hasCard != null;
        return {
            accountId,
            balanceRon,
            lifetimeSpentRon: Number(row.lifetime_spent),
            lifetimeTopupRon: Number(row.lifetime_topup),
            canGenerate: balanceRon > floor,
            minBalanceRon: floor,
            minBalanceIsCustom: Number.isFinite(stored) && stored !== exports.MIN_BALANCE_RON,
            autoRefill: {
                enabled,
                targetRon: exports.AUTO_REFILL_TARGET_RON,
                lastTopUpAt: lastRow ? new Date(lastRow.created_at).toISOString() : null,
                lastAmountRon: lastRow ? Number(lastRow.amount_ron) : null,
                reason: enabled ? null : "no_default_card",
            },
        };
    }
    /**
     * May this account start another generation?
     *
     * Both pots, because with allowance-first spending they are interchangeable while the
     * allowance lasts: an account with 4.20 RON of included usage and a zero wallet can
     * still generate, and one with 0 allowance and 3 RON on the card can too. Looking only
     * at the wallet refused the first case outright, which is the common one -- most accounts
     * never fund a card at all.
     */
    async canGenerate(accountId, tier) {
        const balance = await this.getBalance(accountId);
        const allowance = await this.getAllowance(accountId, tier);
        return {
            canGenerate: allowance.remainingRon > 0 || balance.canGenerate,
            balanceRon: balance.balanceRon,
            // The floor this account actually uses, not the hardcoded backstop. Reporting the
            // constant here while deciding on the stored one made the endpoint contradict itself.
            minBalanceRon: balance.minBalanceRon,
            allowanceRemainingRon: allowance.remainingRon,
        };
    }
    /**
     * Throw if the account may not start another generation.
     *
     * Checked *before* the model runs, not after: refusing afterwards means serving a
     * request and then complaining about it. `requiredRon` is the expected cost of the
     * request being attempted, used only for the message.
     */
    async assertCanGenerate(accountId, modelKey, tier) {
        const state = await this.canGenerate(accountId, tier);
        if (state.canGenerate)
            return;
        throw new InsufficientBalanceError(state.balanceRon, 0);
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
    /**
     * Anonymous allowance for this month, created on first read.
     *
     * Keyed by fingerprint rather than account, because an anonymous visitor has no
     * account. Granted the anonymous figure and always consumed at *list* price: there is
     * no subscription, so there is no discount to apply.
     */
    async getAnonymousAllowance(fingerprint) {
        const pool = this.db.getPool();
        const month = (0, tier_allowance_1.monthKey)();
        const result = await pool.query(`INSERT INTO ai_anonymous_allowance (fingerprint, month_key, granted_ron)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (fingerprint, month_key) DO UPDATE
			   SET fingerprint = EXCLUDED.fingerprint
			 RETURNING granted_ron, spent_ron`, [fingerprint, month, tier_allowance_1.ANONYMOUS_ALLOWANCE_RON]);
        const row = result.rows[0];
        const spent = Number(row.spent_ron);
        return {
            accountId: 0,
            month,
            tier: "anonymous",
            grantedRon: Number(row.granted_ron),
            spentRon: spent,
            remainingRon: (0, model_pricing_1.roundMoney)(Math.max(0, Number(row.granted_ron) - spent)),
            resetAt: (0, tier_allowance_1.nextReset)().toISOString(),
        };
    }
    /**
     * Record an anonymous generation against the fingerprint's allowance.
     *
     * Same shape as `recordUsage` and deliberately *not* an overload of it: an anonymous
     * caller has no wallet, no tier and no card, so there is exactly one pot to draw on and
     * nothing to fall back to. If the allowance is spent the cost is still recorded, so the
     * audit trail shows what the visit actually cost rather than stopping at the limit.
     */
    async recordAnonymousUsage(params) {
        const { fingerprint, modelKey } = params;
        const requestId = params.requestId ? String(params.requestId).slice(0, 128) : null;
        const price = (0, model_pricing_1.resolveTokenPrice)(modelKey, false);
        const inputTokens = clampTokens(params.usage?.inputTokens);
        const outputTokens = clampTokens(params.usage?.outputTokens);
        const metered = price.known && inputTokens + outputTokens > 0;
        const cost = metered ? (0, model_pricing_1.costRon)(modelKey, { inputTokens, outputTokens }, false) : 0;
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            try {
                if (requestId) {
                    const existing = await client.query(`SELECT cost_ron FROM ai_token_usage WHERE request_id = $1 LIMIT 1`, [requestId]);
                    if (existing.rows.length > 0) {
                        await client.query("ROLLBACK");
                        const state = await this.getAnonymousAllowance(fingerprint);
                        return {
                            recorded: false,
                            costRon: Number(existing.rows[0].cost_ron),
                            allowanceAppliedRon: Number(existing.rows[0].cost_ron),
                            remainingRon: state.remainingRon,
                        };
                    }
                }
                const month = (0, tier_allowance_1.monthKey)();
                const drawn = await this.drawAnonymousAllowanceTx(client, fingerprint, cost);
                const before = await client.query(`INSERT INTO ai_anonymous_allowance (fingerprint, month_key, granted_ron)
					 VALUES ($1, $2, $3)
					 ON CONFLICT (fingerprint, month_key) DO UPDATE
					SET fingerprint = EXCLUDED.fingerprint
					 RETURNING granted_ron, spent_ron`, [fingerprint, month, tier_allowance_1.ANONYMOUS_ALLOWANCE_RON]);
                const remaining = (0, model_pricing_1.roundMoney)(Math.max(0, Number(before.rows[0].granted_ron) - Number(before.rows[0].spent_ron)));
                await client.query(`INSERT INTO ai_token_usage
					   (account_id, model_key, input_tokens, output_tokens,
					    input_price_per1m, output_price_per1m, subscriber_discount,
					    cost_ron, allowance_applied_ron, metered, request_id, balance_after)
					 VALUES (NULL, $1, $2, $3, $4, $5, 0, $6, $7, $8, $9, NULL)`, [
                    modelKey,
                    inputTokens,
                    outputTokens,
                    price.apiInputPer1M,
                    price.apiOutputPer1M,
                    cost,
                    drawn,
                    metered,
                    requestId,
                ]);
                await client.query("COMMIT");
                return { recorded: true, costRon: cost, allowanceAppliedRon: drawn, remainingRon: remaining };
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
    /** Anonymous draw on the caller's transaction, capped at what is left. */
    async drawAnonymousAllowanceTx(client, fingerprint, cost) {
        if (!(cost > 0))
            return 0;
        const month = (0, tier_allowance_1.monthKey)();
        const inserted = await client.query(`INSERT INTO ai_anonymous_allowance (fingerprint, month_key, granted_ron, spent_ron)
			 VALUES ($1, $2, $3, 0)
			 ON CONFLICT (fingerprint, month_key) DO UPDATE
			SET fingerprint = EXCLUDED.fingerprint
			 RETURNING granted_ron, spent_ron`, [fingerprint, month, tier_allowance_1.ANONYMOUS_ALLOWANCE_RON]);
        const row = inserted.rows[0];
        const remaining = Math.max(0, Number(row.granted_ron) - Number(row.spent_ron));
        const drawn = (0, model_pricing_1.roundMoney)(Math.min(cost, remaining));
        if (drawn <= 0)
            return 0;
        await client.query(`UPDATE ai_anonymous_allowance
			    SET spent_ron = spent_ron + $3, updated_at = NOW()
			  WHERE fingerprint = $1 AND month_key = $2`, [fingerprint, month, drawn]);
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
    async fund(accountId, amountRon, cardId, source = "user", idempotencyKey, onlyBelowFloor = false) {
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
            const balRow = (await client.query(`SELECT balance_ron, min_balance_ron FROM account_balances WHERE account_id = $1 FOR UPDATE`, [accountId])).rows[0];
            const before = Number(balRow.balance_ron);
            // The refill guard, inside the transaction and under a row lock.
            //
            // Checked here rather than by the caller because the caller cannot see it: two
            // concurrent requests both observe a low balance, and both conclude a refill is
            // due. Reading the balance under FOR UPDATE is what makes the second one find a
            // balance that is no longer at the floor.
            if (onlyBelowFloor) {
                const storedFloor = Number(balRow.min_balance_ron);
                const floor = Number.isFinite(storedFloor) ? storedFloor : exports.MIN_BALANCE_RON;
                if (before > floor) {
                    await client.query("ROLLBACK");
                    return { addedRon: 0, balanceRon: before, capped: false, skipped: true };
                }
            }
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
        const result = await pool.query(`SELECT model_key, input_tokens, output_tokens, cost_ron, allowance_applied_ron,
			        uncovered_ron, metered, created_at
			   FROM ai_token_usage
			  WHERE account_id = $1
			  ORDER BY created_at DESC, id DESC
			  LIMIT $2`, [accountId, capped]);
        return result.rows.map((r) => {
            // The label the customer recognises, resolved from the same table that priced the
            // row. A ledger of `lfm2_5_2_6b_q4_0` is technically correct and unreadable.
            const price = (0, model_pricing_1.resolveTokenPrice)(String(r.model_key), false);
            return {
                modelKey: r.model_key,
                label: price.label || String(r.model_key),
                inputTokens: Number(r.input_tokens),
                outputTokens: Number(r.output_tokens),
                costRon: Number(r.cost_ron),
                allowanceAppliedRon: Number(r.allowance_applied_ron),
                // Surfaced rather than folded away: a cost the wallet could not take is the
                // one number a customer cannot reconcile on their own.
                uncoveredRon: Number(r.uncovered_ron ?? 0),
                metered: Boolean(r.metered),
                createdAt: r.created_at,
            };
        });
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
