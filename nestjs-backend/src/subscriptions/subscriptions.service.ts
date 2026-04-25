import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

const SUBSCRIPTION_PRICES: Record<string, Record<string, number>> = {
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

@Injectable()
export class SubscriptionsService {
  constructor(private readonly db: DatabaseService) {}

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

  async cancelSubscription(accountId: number) {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT id FROM user_subscriptions WHERE account_id=$1 AND is_active=TRUE", [accountId]);
      if (!result.rows[0]) throw new NotFoundException({ error: "No active subscription found" });
      await client.query("UPDATE user_subscriptions SET auto_renew=FALSE, updated_at=NOW() WHERE id=$1", [result.rows[0].id]);
      await client.query("UPDATE accounts SET subscription='Free' WHERE id=$1", [accountId]);
      return { message: "Subscription cancelled. Access continues until renewal date." };
    } finally { client.release(); }
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
}
