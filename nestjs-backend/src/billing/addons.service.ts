import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { ChargeProvider } from "./charge-provider";
import { canUseSpectre } from "./tier-allowance";

/**
 * Products sold alongside the subscription tiers.
 *
 * ## Why this is not another tier
 *
 * A tier answers "what plan is this account on" and carries a monthly usage allowance with
 * it. The Spectre subscription answers "may this account open the Playground", and includes
 * no usage at all -- the 99.99 RON buys access to the product and every token is a separate
 * meter at API list price. Those are different kinds of thing, so they are stored
 * separately and checked separately.
 *
 * Max and Ultimate still grant Playground access on their own, so a customer never has to
 * buy the add-on twice. See `resolveSpectreAccess` for which reason applies, because the UI
 * needs to say *why* someone has access, not merely that they do.
 */

/** Commercial terms for the Spectre Playground subscription. */
export const SPECTRE_ADDON = {
	code: "spectre",
	monthlyRon: 99.99,
	annualRon: 1099.99,
} as const;

/** What the product buys, for the copy on the plans page and the line-up. */
export const SPECTRE_ADDON_SUMMARY = {
	title: "Spectre Playground",
	monthlyRon: SPECTRE_ADDON.monthlyRon,
	annualRon: SPECTRE_ADDON.annualRon,
	/** True, and stated plainly: the subscription is not an allowance. */
	includesUsage: false,
	blurb: "Full access to the Spectre Playground. Model usage is billed separately at API prices.",
} as const;

export type SpectreAccessSource = "addon" | "tier" | null;

export type SpectreAccess = {
	hasAccess: boolean;
	source: SpectreAccessSource;
	/** Set when the access comes from the add-on, so the UI can show its end date. */
	expiresAt: string | null;
	autoRenew: boolean;
	/** True when this account may fund a wallet: the add-on, or a Spectre tier. */
	canFundWallet: boolean;
};

@Injectable()
export class AddonsService {
	constructor(
		private readonly db: DatabaseService,
		private readonly charges: ChargeProvider,
	) {}

	/**
	 * May this account use the Spectre Playground, and why?
	 *
	 * The add-on is checked first so a paying customer who bought it is told the add-on is
	 * what they have, rather than being credited to a tier that happens to grant the same
	 * access. It matters when the two diverge -- cancelling the add-on on a Max account
	 * leaves access intact, and the customer should not be told they lost it.
	 */
	async resolveSpectreAccess(
		accountId: number,
		tier: string,
		/** True for the tiers that bundle Playground access. */
		tierGrantsAccess: boolean,
	): Promise<SpectreAccess> {
		const result = await this.db.getPool().query(
			`SELECT expires_at, auto_renew, status
			   FROM account_addons
			  WHERE account_id = $1 AND addon_code = $2
			    AND status IN ('active', 'cancelled')
			  ORDER BY created_at DESC
			  LIMIT 1`,
			[accountId, SPECTRE_ADDON.code],
		);
		const row = result.rows[0];

		// Expiry is compared here rather than swept by a job: a missed renewal run then
		// cannot silently extend access, and the failure mode is a customer losing access
		// rather than gaining it.
		const addonValid = Boolean(row) && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now());

		if (tierGrantsAccess) {
			// The tier is checked FIRST, and that ordering is load-bearing rather than
			// cosmetic.
			//
			// With the add-on checked first, a Max account holding a stale add-on resolved to
			// `source: 'addon'`, and the billing policy treats that as "the subscription
			// includes no usage" -- so the Playground charged their wallet and skipped the
			// 100 RON allowance entirely. Making Max unable to buy the add-on is what creates
			// the stale-add-on path in the first place, through upgrading, so the two changes
			// have to ship together.
			return {
				hasAccess: true,
				source: "tier",
				expiresAt: null,
				autoRenew: true,
				canFundWallet: true,
			};
		}
		if (addonValid) {
			return {
				hasAccess: true,
				source: "addon",
				expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
				autoRenew: Boolean(row.auto_renew),
				canFundWallet: true,
			};
		}
		return {
			hasAccess: false,
			source: null,
			expiresAt: null,
			autoRenew: false,
			canFundWallet: false,
		};
	}

	async hasActiveAddon(accountId: number): Promise<boolean> {
		const result = await this.db.getPool().query(
			`SELECT 1 FROM account_addons
			  WHERE account_id = $1 AND addon_code = $2
			    AND status IN ('active', 'cancelled')
			    AND (expires_at IS NULL OR expires_at > NOW())
			  LIMIT 1`,
			[accountId, SPECTRE_ADDON.code],
		);
		return result.rows.length > 0;
	}

	/**
	 * Buy the add-on.
	 *
	 * Charged before the row is written, for the same reason `fund()` charges first: the
	 * worst case is a charge that succeeded and a write that failed, which the provider
	 * reference can repair. The reverse hands out access that nobody paid for.
	 */
	async purchase(
		accountId: number,
		billingCycle: "monthly" | "annual",
		cardId: number | null,
		/** The account's tier, so the service can refuse without trusting the caller. */
		tier: string,
	): Promise<{ addon: SpectreAccess; priceRon: number }> {
		if (!["monthly", "annual"].includes(billingCycle)) {
			throw new BadRequestException({ error: "INVALID_BILLING_CYCLE" });
		}

		// Max and Ultimate already include the Playground, so they may not buy it.
		//
		// Checked here rather than only in the UI: hiding the button is presentation, and a
		// customer on a bundled plan who can still POST 99.99 RON a month for something their
		// plan covers is being charged twice. The error names the plan that already has it,
		// because "not allowed" with no reason is the least actionable thing we could say.
		if (canUseSpectre(tier)) {
			throw new BadRequestException({
				error: "ADDON_INCLUDED_IN_PLAN",
				message: `The Spectre Playground is already included with your ${tier.toUpperCase()} plan, so there is nothing to add.`,
				currentTier: String(tier).toLowerCase(),
			});
		}

		if (cardId == null) {
			throw new BadRequestException({
				error: "NO_DEFAULT_CARD",
				message: "Add a default card before subscribing to the Spectre Playground.",
			});
		}

		const pool = this.db.getPool();
		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			const existing = await client.query(
				`SELECT id FROM account_addons
				  WHERE account_id = $1 AND addon_code = $2
				    AND status IN ('active','cancelled')
				    AND (expires_at IS NULL OR expires_at > NOW())
				  LIMIT 1`,
				[accountId, SPECTRE_ADDON.code],
			);
			if (existing.rows.length > 0) {
				await client.query("ROLLBACK");
				throw new BadRequestException({
					error: "ADDON_ALREADY_ACTIVE",
					message: "The Spectre Playground subscription is already active on this account.",
				});
			}

			const priceRon = billingCycle === "annual" ? SPECTRE_ADDON.annualRon : SPECTRE_ADDON.monthlyRon;
			const reference = `spectre-${accountId}-${billingCycle}-${new Date().toISOString().slice(0, 10)}`;

			// Charged inside the transaction, immediately before the row is written.
			//
			// Writing the add-on and the payment separately was how a customer could be given
			// access with no charge recorded at all, or a payment row for something that was
			// never granted. Same ordering as `fund()`: the worst case is a charge that
			// succeeded and a rollback, repairable from the reference.
			const charge = await this.charges.charge({
				cardId,
				amountRon: priceRon,
				currency: "RON",
				reference,
				description: `Spectre Playground subscription (${billingCycle})`,
			});
			if (charge.ok === false) {
				await client.query("ROLLBACK");
				throw new BadRequestException({
					error: charge.code === "card_declined" ? "CARD_DECLINED" : "CHARGE_FAILED",
					message: charge.message,
					retryable: charge.retryable,
				});
			}

			const expiresAt = new Date();
			if (billingCycle === "annual") expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
			else expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 1);

			// A previous cancelled row is closed out rather than deleted, so the history of
			// what this account bought is not rewritten by re-subscribing.
			await client.query(
				`UPDATE account_addons SET status = 'ended', updated_at = NOW()
				  WHERE account_id = $1 AND addon_code = $2 AND status IN ('cancelled','ended')`,
				[accountId, SPECTRE_ADDON.code],
			);
			await client.query(
				`INSERT INTO account_addons
				   (account_id, addon_code, price_ron, billing_cycle, status, expires_at, auto_renew, card_id)
				 VALUES ($1, $2, $3, $4, 'active', $5, TRUE, $6)`,
				[accountId, SPECTRE_ADDON.code, priceRon, billingCycle, expiresAt.toISOString(), cardId],
			);

			// The purchase appears in the customer's own payment history. Without this row a
			// customer who bought the subscription has no record anywhere that they did.
			await client.query(
				`INSERT INTO subscription_payments
				   (account_id, tier, billing_cycle, amount_ron, currency, card_id,
				    payment_status, fulfilment_status, reference, idempotency_key, scope)
				 VALUES ($1, 'spectre', $2, $3, 'RON', $4, 'paid', 'delivered', $5, $5, 'spectre')
				 ON CONFLICT (account_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
				[accountId, billingCycle, priceRon, cardId, reference],
			);

			await client.query("COMMIT");

			return {
				priceRon,
				addon: {
					hasAccess: true,
					source: "addon",
					expiresAt: expiresAt.toISOString(),
					autoRenew: true,
					canFundWallet: true,
				},
			};
		} catch (e) {
			await client.query("ROLLBACK").catch(() => undefined);
			throw e;
		} finally {
			client.release();
		}
	}

	/**
	 * Cancel, keeping access until the period already paid for ends.
	 *
	 * The tier does exactly this, and for the same reason: dropping access immediately after
	 * a customer paid a month for it is not a cancellation, it is a theft with a button.
	 */
	async cancel(accountId: number): Promise<{ accessUntil: string | null }> {
		const result = await this.db.getPool().query(
			`UPDATE account_addons
			    SET auto_renew = FALSE, status = 'cancelled', updated_at = NOW()
			  WHERE account_id = $1 AND addon_code = $2 AND status = 'active'
			  RETURNING expires_at`,
			[accountId, SPECTRE_ADDON.code],
		);
		if (result.rows.length === 0) {
			throw new BadRequestException({
				error: "NO_ACTIVE_ADDON",
				message: "There is no active Spectre subscription to cancel.",
			});
		}
		const row = result.rows[0];
		return {
			accessUntil: row.expires_at ? new Date(row.expires_at).toISOString() : null,
		};
	}

	/**
	 * Renew add-ons whose period has ended.
	 *
	 * Same three properties as `renewDueSubscriptions`, for the same reasons:
	 * `FOR UPDATE SKIP LOCKED` so parallel workers take different rows, the expiry advanced
	 * before the payment row is written so a crash is reconcilable one way only, and a
	 * declined charge leaves the row alone rather than pretending it renewed.
	 */
	async renewDue(): Promise<number> {
		const pool = this.db.getPool();
		const client = await pool.connect();
		let renewed = 0;
		try {
			await client.query("BEGIN");
			const due = await client.query(
				`SELECT id, account_id, price_ron, billing_cycle, card_id, expires_at
				   FROM account_addons
				  WHERE status = 'active' AND auto_renew = TRUE AND card_id IS NOT NULL
				    AND expires_at IS NOT NULL AND expires_at <= NOW()
				  ORDER BY expires_at ASC
				  LIMIT 200
				  FOR UPDATE SKIP LOCKED`,
			);

			for (const row of due.rows) {
				// Derived from the period being renewed, so a retry charges once.
				const periodStart = new Date(row.expires_at);
				const reference = `spectre-renew-${row.id}-${periodStart.toISOString().slice(0, 10)}`;
				const charge = await this.charges.charge({
					cardId: Number(row.card_id),
					amountRon: Number(row.price_ron),
					currency: "RON",
					reference,
					description: `Spectre Playground renewal (${row.billing_cycle})`,
				});
				if (charge.ok === false) continue;

				const next = new Date(periodStart);
				if (String(row.billing_cycle) === "annual") next.setUTCFullYear(next.getUTCFullYear() + 1);
				else next.setUTCMonth(next.getUTCMonth() + 1);

				await client.query(
					`UPDATE account_addons SET expires_at = $1, updated_at = NOW() WHERE id = $2`,
					[next.toISOString(), row.id],
				);
				await client.query(
					`INSERT INTO subscription_payments
					   (account_id, tier, billing_cycle, amount_ron, currency, card_id,
					    payment_status, fulfilment_status, reference, idempotency_key, scope)
					 VALUES ($1, 'spectre', $2, $3, 'RON', $4, 'paid', 'delivered', $5, $5, 'spectre')
					 ON CONFLICT (account_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
					[row.account_id, row.billing_cycle, Number(row.price_ron), row.card_id, reference],
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

	/** Close out cancelled add-ons once their paid period has ended. */
	async retireExpired(): Promise<number> {
		const result = await this.db.getPool().query(
			`UPDATE account_addons SET status = 'ended', updated_at = NOW()
			  WHERE status = 'cancelled' AND expires_at IS NOT NULL AND expires_at <= NOW()`,
		);
		return result.rowCount ?? 0;
	}

	/** The account's add-ons, for the account page. */
	async listForAccount(accountId: number): Promise<Array<Record<string, unknown>>> {
		const result = await this.db.getPool().query(
			`SELECT addon_code, price_ron, billing_cycle, status, started_at, expires_at, auto_renew,
			        (expires_at IS NOT NULL AND expires_at <= NOW()) AS expired
			   FROM account_addons
			  WHERE account_id = $1
			  ORDER BY created_at DESC`,
			[accountId],
		);
		return result.rows.map((row) => ({
			addonCode: row.addon_code,
			priceRon: Number(row.price_ron),
			billingCycle: row.billing_cycle,
			status: row.expired && row.status === "active" ? "ended" : row.status,
			startedAt: row.started_at,
			expiresAt: row.expires_at,
			autoRenew: Boolean(row.auto_renew),
		}));
	}
}