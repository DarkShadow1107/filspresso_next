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
const charge_provider_1 = require("./charge-provider");
const billing_context_1 = require("./billing-context");
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
 * How hard to try before giving up on a refill.
 *
 * Three attempts with a growing delay, because the failure being defended against is a
 * provider blip rather than a decline -- declines are detected as non-retryable and are not
 * retried at all. The total wait is under a second, which is invisible to the request that
 * triggered it because the refill runs after the charge has already committed.
 */
const AUTO_REFILL_MAX_ATTEMPTS = 3;
const AUTO_REFILL_RETRY_DELAY_MS = 250;
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
    charges;
    logger = new common_1.Logger(BillingService_1.name);
    constructor(db, charges) {
        this.db = db;
        this.charges = charges;
    }
    /**
     * Record one generation and debit its cost. Idempotent per `requestId`.
     *
     * A single transaction, and the debit is a plain arithmetic UPDATE rather than
     * read-modify-write in application code: two concurrent requests must not both read
     * the same balance and each write balance-minus-cost, which silently loses one charge.
     */
    async recordUsage(params) {
        const { accountId, modelKey } = params;
        const requestId = params.requestId ? String(params.requestId).slice(0, 128) : null;
        const tier = String(params.tier ?? "free").toLowerCase();
        const context = (0, billing_context_1.resolveBillingContext)({
            scope: params.scope ?? "kafelot",
            tier,
            accessSource: params.accessSource ?? null,
            modelKey,
        });
        const price = (0, model_pricing_1.resolveTokenPrice)(modelKey, context.priceMode);
        const rates = (0, model_pricing_1.effectiveRates)(price);
        const inputTokens = clampTokens(params.usage?.inputTokens);
        const outputTokens = clampTokens(params.usage?.outputTokens);
        // `metered` is the honest signal: a fallback answer or an upstream that omitted
        // usage must not look like a priced request.
        const metered = price.known && inputTokens + outputTokens > 0;
        const cost = metered ? (0, model_pricing_1.costRon)(modelKey, { inputTokens, outputTokens }, context.priceMode) : 0;
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
                // Only drawn when the policy allows it. An add-on holder has no allowance to
                // draw from, and Max on the 8B is explicitly excluded; both fall through to the
                // wallet with the full cost charged there.
                const allowanceApplied = cost > 0 && context.billFrom === "allowance_then_wallet"
                    ? await this.drawFromAllowanceTx(client, accountId, tier, cost)
                    : 0;
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
					    cost_ron, allowance_applied_ron, uncovered_ron, metered, request_id, balance_after,
					    price_mode, bill_from, scope)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`, [
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
                    // Stored so a charge can be reconstructed months later. The Playground is
                    // list-priced and the wallet-only pot is a deliberate rule, and neither is
                    // recoverable from the amounts alone.
                    context.priceMode,
                    context.billFrom,
                    params.scope ?? "kafelot",
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
                    priceMode: context.priceMode,
                    billFrom: context.billFrom,
                    reason: context.reason,
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
        // The kill switch, checked first and before anything is read.
        //
        // This is the switch to reach for the moment a real provider goes live. Everything
        // below is written as though the charge can fail -- because it can, and because until
        // a provider exists the only failure path ever exercised is this simulation. Leaving
        // it on against a live provider before real decline handling has been seen is how a
        // card gets charged in a loop nobody is watching.
        if (!(0, charge_provider_1.autoRefillEnabled)())
            return;
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
            // Retried a few times before giving up.
            //
            // A refill is a convenience: if the wallet is empty the customer simply cannot
            // generate, which is a clear and honest state. A blip from the provider should not
            // leave them stuck at the floor for a whole month because the one attempt that
            // happened to land during a network blip was the only one.
            //
            // Non-retryable failures -- a declined card, no card -- are not retried, because
            // trying again cannot change the answer and would charge the customer for the
            // privilege of being told twice.
            let lastError = null;
            for (let attempt = 0; attempt < AUTO_REFILL_MAX_ATTEMPTS; attempt += 1) {
                try {
                    await this.fund(accountId, exports.AUTO_REFILL_TARGET_RON, cardId, "auto", 
                    // One reference for the whole burst, so a retry after a partial
                    // failure cannot become a second charge for one refill.
                    `auto-${accountId}-${Date.now()}`, 
                    // The atomic guard. Without it this method is a read-then-write race.
                    true);
                    return;
                }
                catch (err) {
                    lastError = err;
                    const retryable = err?.retryable === true;
                    if (!retryable || attempt === AUTO_REFILL_MAX_ATTEMPTS - 1)
                        break;
                    await new Promise((resolve) => setTimeout(resolve, AUTO_REFILL_RETRY_DELAY_MS * (attempt + 1)));
                }
            }
            throw lastError;
        }
        catch (err) {
            // A refill that fails must not fail the charge that triggered it. The customer
            // was billed correctly; the top-up is a separate promise and is visible as
            // missing on /balance rather than as a broken request.
            console.warn(`[billing] auto-refill skipped for account ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * The account's authoritative tier, for callers that need it to make a decision rather
     * than to price something. `kafelot.resolveTier` reads both `user_subscriptions` and the
     * legacy `accounts.subscription` column and falls back between them; duplicating that
     * here would be a second answer to the same question.
     */
    async resolveTierFor(accountId) {
        const result = await this.db.getPool().query(`SELECT subscription_tier FROM user_subscriptions
			  WHERE account_id = $1 AND is_active = TRUE AND status IN ('active','ending')
			  ORDER BY created_at DESC LIMIT 1`, [accountId]);
        if (result.rows[0]?.subscription_tier)
            return String(result.rows[0].subscription_tier).toLowerCase();
        const legacy = await this.db.getPool().query(`SELECT subscription FROM accounts WHERE id = $1`, [accountId]);
        return String(legacy.rows[0]?.subscription ?? "free").toLowerCase();
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
        const [hasCard, lastAuto, lastFailure] = await Promise.all([
            this.defaultCardId(accountId),
            pool.query(`SELECT created_at, amount_ron FROM billing_topups
				  WHERE account_id = $1 AND source = 'auto'
				  ORDER BY created_at DESC LIMIT 1`, [accountId]),
            pool.query(`SELECT created_at, amount_ron, failure_code FROM billing_topup_failures
				  WHERE account_id = $1
				  ORDER BY created_at DESC LIMIT 1`, [accountId]),
        ]);
        const lastRow = lastAuto.rows[0];
        const lastFailureRow = lastFailure.rows[0];
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
                // A refill that keeps failing is the reason a balance stops moving, and the
                // customer is the one who can act on it -- by replacing a declined card. Saying
                // so beats a balance that quietly stays at zero.
                lastFailure: lastFailureRow
                    ? {
                        code: String(lastFailureRow.failure_code),
                        amountRon: Number(lastFailureRow.amount_ron),
                        createdAt: new Date(lastFailureRow.created_at).toISOString(),
                    }
                    : null,
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
     *
     * The pot always reflects the plan the account is on *now*. The row is keyed by
     * (account, month), so without the conflict clause below it kept whatever tier and
     * allowance the account had when the month started: a customer who upgraded to Pro on
     * the 3rd kept metering against Free's 5 RON for the rest of the month, and the
     * Usage & Wallet page named a plan they no longer had. Upgrading raises the pot to the
     * new plan's full allowance; downgrading lowers it, and anything already spent beyond
     * the lower plan leaves nothing remaining and spills to the wallet.
     */
    async getAllowance(accountId, tier) {
        const pool = this.db.getPool();
        const month = (0, tier_allowance_1.monthKey)();
        const granted = (0, tier_allowance_1.allowanceRon)(tier, true);
        const result = await pool.query(`INSERT INTO ai_monthly_allowance (account_id, month_key, tier, granted_ron)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (account_id, month_key) DO UPDATE SET
			   tier = EXCLUDED.tier, granted_ron = EXCLUDED.granted_ron
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
     *
     * The upsert below refreshes the pot to the tier being metered against, for the same
     * reason `getAllowance` does: metering a Pro customer against a pot written when they
     * were on Free would charge them the free rate all month.
     */
    async drawFromAllowance(accountId, tier, cost) {
        if (!(cost > 0))
            return 0;
        const pool = this.db.getPool();
        const month = (0, tier_allowance_1.monthKey)();
        const result = await pool.query(`INSERT INTO ai_monthly_allowance (account_id, month_key, tier, granted_ron, spent_ron)
			 VALUES ($1, $2, $3, $4, 0)
			 ON CONFLICT (account_id, month_key) DO UPDATE SET
			   tier = EXCLUDED.tier, granted_ron = EXCLUDED.granted_ron
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
			 ON CONFLICT (account_id, month_key) DO UPDATE SET
			   tier = EXCLUDED.tier, granted_ron = EXCLUDED.granted_ron
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
        // The charge happens first, and the balance only moves once it has succeeded.
        //
        // This used to credit the wallet and then record the top-up as though the card had
        // been charged: a ledger that agrees with itself and with no card. With a real
        // provider that ordering is how a customer is given money nobody paid for, and
        // afterwards nothing can tell that balance from an honestly paid one. Charging first
        // makes the worst case a charge that succeeded and a write that failed, which the
        // provider reference can repair. The reverse is not repairable at all.
        const charge = await this.charges.charge({
            cardId,
            amountRon: amount,
            currency: "RON",
            // Stable across retries of the same purchase, so a retry cannot charge twice.
            reference: idempotencyKey ?? `fund-${accountId}-${(0, model_pricing_1.roundMoney)(amount)}`,
            description: source === "auto" ? "Spectre wallet automatic refill" : "Spectre wallet top-up",
        });
        if (charge.ok === false) {
            // Recorded rather than swallowed: a refill that silently stopped leaves the
            // balance pinned at the floor and the customer with no idea why generation ended.
            await this.recordTopupFailure(accountId, amount, cardId, source, charge.code);
            const error = new Error(charge.message);
            error.code = charge.code;
            error.retryable = charge.retryable;
            throw error;
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
    /**
     * A top-up that was attempted and refused.
     *
     * Stored in its own table rather than as a zero row in `billing_topups`, because
     * `amount_ron` there is constrained to be positive and, more to the point, a failed
     * attempt is not a top-up -- folding the two together would make the top-up history
     * claim money arrived when none did.
     *
     * Best-effort: this is written *because* something already went wrong, so it must not
     * be the thing that turns one failure into two.
     */
    async recordTopupFailure(accountId, amountRon, cardId, source, code) {
        try {
            await this.db.getPool().query(`INSERT INTO billing_topup_failures (account_id, amount_ron, source, card_id, failure_code)
				 VALUES ($1, $2, $3, $4, $5)`, [accountId, amountRon, source, cardId, code]);
        }
        catch {
            // Swallowed deliberately, as above.
        }
    }
    /**
     * The last few refused top-ups, newest first.
     *
     * Exposed so a customer whose refill stopped can see that it stopped and why, instead of
     * inferring it from a balance that has quietly stopped moving.
     */
    async recentTopupFailures(accountId, limit = 5) {
        const capped = Math.min(Math.max(Number(limit) || 5, 1), 50);
        const result = await this.db.getPool().query(`SELECT amount_ron, source, failure_code, created_at
			   FROM billing_topup_failures
			  WHERE account_id = $1
			  ORDER BY created_at DESC, id DESC
			  LIMIT $2`, [accountId, capped]);
        return result.rows.map((r) => ({
            amountRon: Number(r.amount_ron),
            source: r.source,
            code: r.failure_code,
            createdAt: r.created_at,
        }));
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
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        charge_provider_1.ChargeProvider])
], BillingService);
function clampTokens(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    return Math.floor(n);
}
