import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { ChargeProvider } from "../billing/charge-provider";

export const SUBSCRIPTION_PRICES: Record<string, Record<string, number>> = {
  free: { monthly: 0, annual: 0 },
  basic: { monthly: 55.99, annual: 399.99 },
  plus: { monthly: 109.99, annual: 1099.99 },
  pro: { monthly: 169.99, annual: 1699.99 },
  max: { monthly: 279.99, annual: 2699.99 },
  ultimate: { monthly: 599.99, annual: 6299.99 },
};
const TIER_LEVELS: Record<string, number> = {
  free: 0, basic: 1, plus: 2, pro: 3, max: 4, ultimate: 5,
};

function normalizeSubscriptionTier(raw: unknown): string {
  const normalized = String(raw || "").trim().toLowerCase();
  if (!normalized || normalized === "none") return "free";
  if (Object.prototype.hasOwnProperty.call(TIER_LEVELS, normalized)) return normalized;
  return "free";
}

function calculateRenewalDate(billingCycle: string, from = new Date()): string {
  const d = new Date(from);
  if (billingCycle === "annual") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().split("T")[0];
}

/**
 * Days after purchase within which cancelling is refunded.
 *
 * A guess, not a commercial term. A window shorter than the shortest billing period is the
 * safer default: someone cancelling in the first fortnight of a month is usually having
 * second thoughts about a purchase rather than changing their mind after using it. Set
 * SUBSCRIPTION_REFUND_WINDOW_DAYS to change it, and replace it with the real policy before a
 * payment provider is connected.
 */
const REFUND_WINDOW_DAYS = Math.max(
  0,
  Number(process.env.SUBSCRIPTION_REFUND_WINDOW_DAYS ?? "") || 14,
);

@Injectable()
export class SubscriptionsService {
  constructor(  private readonly chargeProvider: ChargeProvider,
    private readonly db: DatabaseService) {}

  /**
   * The price table, for a checkout that must quote the server's number.
   *
   * The prices lived only in this file, and the web client kept its own copies in three
   * places. They agreed, and then a checkout showed a customer 24.99 RON -- a coffee delivery
   * fee -- because the subscription had been routed through the shopping cart and the cart was
   * empty. A price that is only *displayed* from a client copy is a price that can be wrong on
   * screen while the charge is right, or the other way round. This is the single source for
   * what a subscription costs.
   */
  priceTable(): { currency: "RON"; tiers: Array<{ tier: string; monthly: number; annual: number }> } {
    return {
      currency: "RON",
      tiers: Object.entries(SUBSCRIPTION_PRICES).map(([tier, cycles]) => ({
        tier,
        monthly: cycles.monthly ?? 0,
        annual: cycles.annual ?? 0,
      })),
    };
  }

  async getSubscription(accountId: number) {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const currentResult = await client.query(
        `SELECT us.id, us.subscription_tier, us.billing_cycle, us.price_ron,
                us.start_date, us.renewal_date, us.end_date, us.is_active, us.auto_renew, us.status,
                us.card_id, uc.card_last_four, uc.card_type
         FROM user_subscriptions us
         LEFT JOIN user_cards uc ON us.card_id = uc.id
         WHERE us.account_id = $1 AND us.status IN ('active', 'ending')
         ORDER BY us.is_active DESC, us.created_at DESC LIMIT 1`,
        [accountId],
      );
      const currentSub = currentResult.rows[0];
      const scheduledResult = await client.query(
        `SELECT us.id, us.subscription_tier, us.billing_cycle, us.price_ron,
                us.start_date, us.renewal_date, us.is_active, us.status,
                us.card_id, uc.card_last_four, uc.card_type
         FROM user_subscriptions us
         LEFT JOIN user_cards uc ON us.card_id = uc.id
         WHERE us.account_id = $1 AND us.status = 'scheduled'
         ORDER BY us.start_date ASC LIMIT 1`,
        [accountId],
      );
      const scheduledSub = scheduledResult.rows[0];
      if (!currentSub) {
        const accountResult = await client.query("SELECT subscription FROM accounts WHERE id = $1 LIMIT 1", [accountId]);
        const accountTier = normalizeSubscriptionTier(accountResult.rows[0]?.subscription);
        return {
          subscription: { tier: accountTier, billing_cycle: null, price_ron: accountTier === "free" ? 0 : null, start_date: null, renewal_date: null, end_date: null, is_active: true, auto_renew: false, status: "active", card: null },
          scheduled: null,
        };
      }
      const cardOf = (sub: Record<string, unknown>) =>
        sub.card_id ? { id: sub.card_id, last_four: sub.card_last_four, type: sub.card_type } : null;
      return {
        subscription: {
          id: currentSub.id,
          tier: normalizeSubscriptionTier(currentSub.subscription_tier),
          billing_cycle: currentSub.billing_cycle,
          price_ron: Number(currentSub.price_ron),
          start_date: currentSub.start_date,
          renewal_date: currentSub.renewal_date,
          end_date: currentSub.end_date,
          is_active: currentSub.is_active,
          auto_renew: currentSub.auto_renew,
          status: currentSub.status,
          card: cardOf(currentSub as Record<string, unknown>),
        },
        scheduled: scheduledSub ? { id: scheduledSub.id, tier: scheduledSub.subscription_tier, billing_cycle: scheduledSub.billing_cycle, price_ron: Number(scheduledSub.price_ron), start_date: scheduledSub.start_date, renewal_date: scheduledSub.renewal_date, status: scheduledSub.status, card: cardOf(scheduledSub as Record<string, unknown>) } : null,
      };
    } finally {
      client.release();
    }
  }

  async createSubscription(accountId: number, body: { tier?: string; billingCycle?: string; cardId?: number }) {
    const { tier, billingCycle, cardId } = body;
    if (!tier || !["free", "basic", "plus", "pro", "max", "ultimate"].includes(String(tier))) {
      throw new BadRequestException({ error: "Invalid subscription tier" });
    }
    if (tier !== "free" && !["monthly", "annual"].includes(String(billingCycle || ""))) {
      throw new BadRequestException({ error: "Invalid billing cycle" });
    }
    const price = tier === "free" ? 0 : (SUBSCRIPTION_PRICES[tier]?.[billingCycle as string] ?? 0);
    const startDate = new Date().toISOString().split("T")[0];
    const renewalDate = tier === "free" ? null : calculateRenewalDate(billingCycle as string);
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE user_subscriptions SET is_active = FALSE, status = 'cancelled' WHERE account_id = $1", [accountId]);
      const result = await client.query(
        `INSERT INTO user_subscriptions (account_id, subscription_tier, billing_cycle, price_ron, start_date, renewal_date, is_active, auto_renew, status, card_id) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,'active',$8) RETURNING id`,
        [accountId, tier, billingCycle || "monthly", price, startDate, renewalDate, tier !== "free", cardId || null],
      );
      await client.query("UPDATE accounts SET subscription = $1 WHERE id = $2", [tier.charAt(0).toUpperCase() + tier.slice(1), accountId]);

      // A plan that already includes the Playground makes any Spectre subscription on this
      // account redundant. Auto-renew stops; access continues to the end of the paid period.
      await this.endRedundantAddon(accountId, tier);

      // The payment record goes in the same transaction as the subscription itself.
      //
      // Written separately it could drift: a crash between the two leaves a customer who has
      // been charged with no history showing it, or a history row for a plan that was never
      // granted. Neither is reconcilable from the customer's side, which is the only side
      // that matters here.
      //
      // Nothing is recorded for the free tier, because nothing was charged. A "payment" of
      // 0.00 would be a fiction.
      if (price > 0) {
        await client.query(
          `INSERT INTO subscription_payments
             (account_id, tier, billing_cycle, amount_ron, currency, card_id,
              payment_status, fulfilment_status, reference, idempotency_key)
           VALUES ($1, $2, $3, $4, 'RON', $5, 'paid', 'delivered', $6, $7)
           ON CONFLICT (account_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
          [
            accountId,
            tier,
            billingCycle || "monthly",
            price,
            cardId || null,
            body["reference"] ? String(body["reference"]).slice(0, 64) : null,
            body["idempotencyKey"] ? String(body["idempotencyKey"]).slice(0, 128) : null,
          ],
        );
      }
      await client.query("COMMIT");
      return { id: Number(result.rows[0].id), tier, billing_cycle: billingCycle, price_ron: price, start_date: startDate, renewal_date: renewalDate, is_active: true, auto_renew: tier !== "free", status: "active" };
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  }

  async changeSubscription(accountId: number, body: { tier?: string; billingCycle?: string; cardId?: number }) {
    const { tier, billingCycle, cardId } = body;
    if (!tier || !["basic", "plus", "pro", "max", "ultimate"].includes(String(tier))) throw new BadRequestException({ error: "Invalid subscription tier" });
    if (!["monthly", "annual"].includes(String(billingCycle || ""))) throw new BadRequestException({ error: "Invalid billing cycle" });
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cr = await client.query(`SELECT id, subscription_tier, renewal_date, card_id FROM user_subscriptions WHERE account_id = $1 AND is_active = TRUE AND status IN ('active','ending') LIMIT 1`, [accountId]);
      const currentSub = cr.rows[0];
      if (!currentSub) { await client.query("ROLLBACK"); throw new BadRequestException({ error: "No active subscription to change from" }); }
      await client.query(`DELETE FROM user_subscriptions WHERE account_id = $1 AND status = 'scheduled'`, [accountId]);
      const price = SUBSCRIPTION_PRICES[tier]?.[billingCycle as string] ?? 0;
      const useCardId = cardId || currentSub.card_id;
      const isUpgrade = (TIER_LEVELS[tier] || 0) > (TIER_LEVELS[String(currentSub.subscription_tier)] || 0);
      if (isUpgrade) {
        await client.query(`UPDATE user_subscriptions SET status='ending', end_date=CURRENT_DATE, auto_renew=FALSE, is_active=FALSE WHERE id=$1`, [currentSub.id]);
        const startDate = new Date().toISOString().split("T")[0];
        const renewalDate = calculateRenewalDate(billingCycle as string);
        const result = await client.query(`INSERT INTO user_subscriptions (account_id,subscription_tier,billing_cycle,price_ron,start_date,renewal_date,is_active,auto_renew,status,card_id) VALUES ($1,$2,$3,$4,$5,$6,TRUE,TRUE,'active',$7) RETURNING id`, [accountId, tier, billingCycle, price, startDate, renewalDate, useCardId]);
        await client.query("UPDATE accounts SET subscription=$1 WHERE id=$2", [tier.charAt(0).toUpperCase() + tier.slice(1), accountId]);
        await this.endRedundantAddon(accountId, tier);
        await client.query("COMMIT");
        return { message: "Subscription upgraded successfully! Your new plan is now active.", isUpgrade: true, subscription: { id: Number(result.rows[0].id), tier, billing_cycle: billingCycle, price_ron: price, start_date: startDate, renewal_date: renewalDate, is_active: true, status: "active" } };
      }
      const endDate = currentSub.renewal_date as string;
      await client.query(`UPDATE user_subscriptions SET status='ending', end_date=$1, auto_renew=FALSE WHERE id=$2`, [endDate, currentSub.id]);
      const renewalDate = calculateRenewalDate(billingCycle as string, new Date(endDate));
      const result = await client.query(`INSERT INTO user_subscriptions (account_id,subscription_tier,billing_cycle,price_ron,start_date,renewal_date,is_active,auto_renew,status,card_id) VALUES ($1,$2,$3,$4,$5,$6,FALSE,TRUE,'scheduled',$7) RETURNING id`, [accountId, tier, billingCycle, price, endDate, renewalDate, useCardId]);
      await client.query("COMMIT");
      return { message: `Plan change scheduled. Current plan continues until ${endDate}, then ${tier} will activate.`, isUpgrade: false, currentEnds: endDate, scheduled: { id: Number(result.rows[0].id), tier, billing_cycle: billingCycle, price_ron: price, start_date: endDate, renewal_date: renewalDate, status: "scheduled" } };
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  }

  /**
   * Stop a Spectre subscription that this tier has made redundant.
   *
   * Best-effort on purpose. The entitlement check gives the tier precedence over a stale
   * add-on row, so a failure here cannot cost anyone access -- it could only leave a customer
   * being billed for something their plan covers, which is worth logging but not worth
   * failing a successful upgrade over.
   */
  private async endRedundantAddon(accountId: number, tier: string): Promise<void> {
    try {
      const ended = await this.db.getPool().query(
        `UPDATE account_addons SET auto_renew = FALSE, updated_at = NOW()
          WHERE account_id = $1 AND addon_code = 'spectre' AND status = 'active'`,
        [accountId],
      );
      if (ended.rowCount) {
        console.warn(
          `[subscriptions] stopped a redundant Spectre subscription on account ${accountId} after an upgrade to ${tier}`,
        );
      }
    } catch (err) {
      console.warn(
        `[subscriptions] could not stop a redundant Spectre subscription on account ${accountId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async cancelSubscription(accountId: number) {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT id, subscription_tier, billing_cycle, price_ron, start_date, renewal_date FROM user_subscriptions WHERE account_id=$1 AND is_active=TRUE",
        [accountId],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        throw new NotFoundException({ error: "No active subscription found" });
      }
      const sub = result.rows[0];

      // Access is *kept* until the renewal date, which is what the message has always
      // promised. The previous version dropped `accounts.subscription` to Free in the same
      // breath, so the customer kept a MAX badge and lost AI access on the spot -- and, worse,
      // the two halves disagreed with each other: the subscription row said active while the
      // authoritative tier column said free.
      await client.query("UPDATE user_subscriptions SET auto_renew=FALSE, updated_at=NOW() WHERE id=$1", [sub.id]);

      // A refund, where the commercial terms allow one. Recorded as a row so it appears in
      // the customer's payment history; see `REFUND_WINDOW_DAYS` for why it is a guess.
      const paid = await client.query(
        `SELECT id, amount_ron, created_at FROM subscription_payments
          WHERE account_id = $1 AND tier = $2 AND payment_status = 'paid'
            AND fulfilment_status = 'delivered'
          ORDER BY created_at DESC LIMIT 1`,
        [accountId, sub.subscription_tier],
      );
      let refund = null;
      if (paid.rows[0] && this.withinRefundWindow(paid.rows[0].created_at)) {
        const result2 = await this.chargeProvider.refund({
          providerReference: `sim_${paid.rows[0].id}`,
          amountRon: Number(paid.rows[0].amount_ron),
          reason: `Cancelled within ${REFUND_WINDOW_DAYS} days of purchase`,
        });
        if (result2.ok) {
          await client.query(
            `INSERT INTO subscription_payments
               (account_id, tier, billing_cycle, amount_ron, currency, card_id,
                payment_status, fulfilment_status, reference, refund_of)
             VALUES ($1, $2, $3, -($4)::numeric, 'RON', (SELECT card_id FROM user_subscriptions WHERE id=$5),
                     'refunded', 'revoked', $6, $7::bigint)`,
            [accountId, sub.subscription_tier, sub.billing_cycle, paid.rows[0].amount_ron,
             sub.id, result2.providerReference, paid.rows[0].id],
          );
          refund = { amountRon: Number(paid.rows[0].amount_ron), providerReference: result2.providerReference };
        }
      }

      await client.query("COMMIT");
      return {
        message: refund
          ? `Subscription cancelled and refunded ${refund.amountRon} RON. Access continues until the renewal date.`
          : "Subscription cancelled. Access continues until the renewal date.",
        accessUntil: sub.renewal_date,
        refunded: refund?.amountRon ?? 0,
      };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally { client.release(); }
  }

  /** Days after purchase within which a cancellation is refunded. */
  private withinRefundWindow(purchasedAt: Date | string): boolean {
    const then = new Date(purchasedAt).getTime();
    if (!Number.isFinite(then)) return false;
    return Date.now() - then <= REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  }

  /**
   * Renew every subscription whose period has ended.
   *
   * Two rules make this safe to run repeatedly, which it will be -- on every instance, on
   * every interval, and once more on boot:
   *
   *  * Rows are claimed with `FOR UPDATE SKIP LOCKED`, so two instances working the same
   *    table take different rows rather than contending for the same one.
   *  * The renewal date is advanced by the period *before* the payment row is written, so a
   *    crash in between leaves the subscription looking renewed and the payment unwritten --
   *    which reconciliation can spot and repair. The opposite order would leave a customer
   *    charged twice over with no trace of the first.
   *
   * A renewal whose charge fails is left alone: the renewal date does not move, and the
   * account is downgraded to free by `retireLapsedSubscriptions` on a later pass, once the
   * grace period has passed. That is a real consequence for the customer, so the grace
   * period exists -- and it is a guess, not a commercial term. See the README.
   */
  async renewDueSubscriptions(): Promise<number> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    let renewed = 0;
    try {
      await client.query("BEGIN");
      const due = await client.query(
        `SELECT id, account_id, subscription_tier, billing_cycle, price_ron,
                renewal_date, card_id
           FROM user_subscriptions
          WHERE is_active = TRUE
            AND auto_renew = TRUE
            AND status = 'active'
            AND price_ron > 0
            AND renewal_date IS NOT NULL
            AND renewal_date <= CURRENT_DATE
          ORDER BY renewal_date ASC
          LIMIT 200
          FOR UPDATE SKIP LOCKED`,
      );

      for (const row of due.rows) {
        const price = Number(row.price_ron);
        const cardId = row.card_id as number | null;

        // Skipped, not attempted: retrying a missing card cannot change the answer, and the
        // attempt would show up as a failure the customer cannot fix on their own.
        if (cardId == null) continue;

        const periodStart = new Date(row.renewal_date);
        const nextRenewal = this.addPeriod(periodStart, String(row.billing_cycle));
        const reference = `renew-${row.id}-${periodStart.toISOString().slice(0, 10)}`;

        const charge = await this.chargeProvider.charge({
          cardId,
          amountRon: price,
          currency: "RON",
          reference,
          description: `${row.subscription_tier} subscription renewal`,
        });
        if (charge.ok === false) continue;

        await client.query("UPDATE user_subscriptions SET renewal_date = $1, start_date = $1, updated_at = NOW() WHERE id = $2", [
          nextRenewal.toISOString().slice(0, 10),
          row.id,
        ]);
        await client.query(
          `INSERT INTO subscription_payments
             (account_id, tier, billing_cycle, amount_ron, currency, card_id,
              payment_status, fulfilment_status, reference, idempotency_key)
           VALUES ($1, $2, $3, $4, 'RON', $5, 'paid', 'delivered', $6, $6)
           ON CONFLICT (account_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
          [row.account_id, row.subscription_tier, row.billing_cycle, price, cardId, reference],
        );
        renewed += 1;
      }

      await client.query("COMMIT");
      return renewed;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * End subscriptions that will not renew: cancelled ones past their end date, and
   * auto-renewing ones whose charge kept failing.
   *
   * The grace period is what separates "the card bounced once" from "this customer is not
   * paying". Without it a single network blip would downgrade a paying Max subscriber to
   * free; with no limit at all a card that fails forever would keep their access.
   */
  async retireLapsedSubscriptions(): Promise<number> {
    const graceDays = Math.max(0, Number(process.env.SUBSCRIPTION_RENEWAL_GRACE_DAYS ?? "") || 0);
    const result = await this.db.getPool().query(
      `WITH lapsed AS (
         UPDATE user_subscriptions
            SET is_active = FALSE, status = 'cancelled', updated_at = NOW()
          WHERE is_active = TRUE
            AND renewal_date IS NOT NULL
            AND renewal_date <= CURRENT_DATE - ($1 || ' days')::interval
          RETURNING account_id
       )
       UPDATE accounts a SET subscription = 'Free'
        WHERE a.id IN (SELECT account_id FROM lapsed)`,
      [graceDays],
    );
    return result.rowCount ?? 0;
  }

  private addPeriod(from: Date, billingCycle: string): Date {
    const next = new Date(from);
    if (String(billingCycle) === "annual") next.setUTCFullYear(next.getUTCFullYear() + 1);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  async updateCard(accountId: number, cardId: number) {
    if (!cardId) throw new BadRequestException({ error: "Card ID is required" });
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const cardCheck = await client.query("SELECT id FROM user_cards WHERE id=$1 AND account_id=$2", [cardId, accountId]);
      if (!cardCheck.rows[0]) throw new NotFoundException({ error: "Card not found" });
      await client.query("UPDATE user_subscriptions SET card_id=$1, updated_at=NOW() WHERE account_id=$2 AND is_active=TRUE", [cardId, accountId]);
      return { message: "Payment method updated successfully" };
    } finally { client.release(); }
  }

  async toggleAutoRenew(accountId: number) {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT id, auto_renew FROM user_subscriptions WHERE account_id=$1 AND is_active=TRUE", [accountId]);
      if (!result.rows[0]) throw new NotFoundException({ error: "No active subscription found" });
      const newAutoRenew = !result.rows[0].auto_renew;
      await client.query("UPDATE user_subscriptions SET auto_renew=$1, updated_at=NOW() WHERE id=$2", [newAutoRenew, result.rows[0].id]);
      return { message: newAutoRenew ? "Auto-renewal enabled" : "Auto-renewal disabled", auto_renew: newAutoRenew };
    } finally { client.release(); }
  }

  /**
   * What this account has paid for, newest first.
   *
   * Reports both halves of each purchase: whether the charge completed, and whether access
   * was granted. They are separate columns for a reason -- a row where the money is paid and
   * the plan was never delivered is the state a customer would call us about, and it cannot
   * exist if both facts are collapsed into one status.
   */
  async paymentHistory(accountId: number): Promise<Array<Record<string, unknown>>> {
    const pool = this.db.getPool();
    const result = await pool.query(
      `SELECT p.id, p.tier, p.billing_cycle, p.amount_ron, p.currency, p.payment_status,
              p.fulfilment_status, p.reference, p.created_at, c.card_last_four
         FROM subscription_payments p
         LEFT JOIN user_cards c ON c.id = p.card_id
        WHERE p.account_id = $1
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 100`,
      [accountId],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      tier: row.tier,
      billingCycle: row.billing_cycle,
      amountRon: Number(row.amount_ron),
      currency: row.currency,
      // Last four only, the same as the subscription card view. Never the number itself.
      cardLastFour: row.card_last_four ?? null,
      paymentStatus: row.payment_status,
      fulfilmentStatus: row.fulfilment_status,
      reference: row.reference,
      createdAt: row.created_at,
    }));
  }
}
