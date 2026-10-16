import {
	BadRequestException,
	ForbiddenException,
	HttpException,
	HttpStatus,
	Body,
	Controller,
	Get,
	Module,
	Patch,
	Post,
	Query,
	Req,
	UnauthorizedException,
	UseGuards,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { DatabaseModule } from "../database/database.module";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../common/guards/optional-jwt-auth.guard";
import { forwardRef } from "@nestjs/common";
import { KafelotModule } from "../kafelot/kafelot.module";
import { KafelotService } from "../kafelot/kafelot.service";
import {
	AUTO_REFILL_TARGET_RON,
	BillingService,
	MAX_FUNDED_BALANCE_RON,
} from "./billing.service";
import { pricingTable, resolveTokenPrice } from "./model-pricing";
import { ChargeProvider, SimulatedChargeProvider } from "./charge-provider";
import { AddonsController } from "./addons.controller";
import { AddonsService } from "./addons.service";
import { resolveBillingContext } from "./billing-context";
import {
	isPaidTier,
	canUseSpectre,
	SPECTRE_TIERS_ALLOWED,
	ANONYMOUS_ALLOWANCE_RON,
	TIER_ALLOWANCE_RON,
} from "./tier-allowance";
import { FINGERPRINT_HEADER, parseFingerprint } from "../common/utils/fingerprint";

interface BillingRequest {
	user?: { id?: number | string } | undefined;
	headers?: Record<string, unknown>;
}

/**
 * The caller's fingerprint, validated strictly.
 *
 * Absent entirely is a 401: there is nothing to meter against, and an unmetered caller is
 * an unlimited one. Present but malformed is a 400 from `parseFingerprint` -- never a
 * truncation, never a repair.
 */
function requireFingerprint(req: { headers?: Record<string, unknown> }): string {
	const raw = req.headers?.[FINGERPRINT_HEADER];
	if (raw === undefined || raw === null || raw === "") {
		throw new UnauthorizedException("a session or a fingerprint is required");
	}
	return parseFingerprint(raw);
}

@Controller("api/billing")
export class BillingController {
constructor(
    	private readonly billing: BillingService,
    	private readonly kafelot: KafelotService,
    	private readonly addons: AddonsService,
    ) {}

	/**
	 * The price list, for the model picker and the admin table.
	 *
	 * Public, because prices are not secret and the picker renders them before anyone has
	 * signed in. A subscriber is sent exactly one price -- theirs. Sending both and letting
	 * the client choose would hand the list price to precisely the accounts least entitled
	 * to see it, and would make the displayed number a client-side decision about money.
	 *
	 * `?audience=api` returns the undiscounted list price to anyone, including subscribers.
	 * That is the one deliberate exception, for the Spectre Playground, which is presented
	 * as an API console: it shows what each model costs at list so a user can reason about
	 * their own spend, and the *charge* against their funded balance still uses the
	 * subscriber rate. Displaying a price is not the same as being billed it, and conflating
	 * them would mean the console could only ever show one of the two numbers.
	 */
	@UseGuards(OptionalJwtAuthGuard)
	@Get("pricing")
	async getPricing(@Req() req: BillingRequest & { query?: Record<string, unknown> }) {
		const audience = String(req.query?.audience ?? "");
		const tier = await this.resolveTier(req);
		const subscriber = isPaidTier(tier);
		const table = pricingTable();

		// `audience=all` is for the admin pricing table, the only surface that needs both
		// numbers side by side: what an API caller pays, and what a subscriber pays after the
		// discount. It is the only response that states the percentage outright.
		if (audience === "all") {
			return {
				currency: table.currency,
				unit: table.unit,
				outputMultiplier: table.outputMultiplier,
				subscriber: false,
				listPrice: true,
				models: table.models.map((m) => ({
					modelKey: m.modelKey,
					label: m.label,
					apiInputPer1M: m.apiInputPer1M,
					apiOutputPer1M: m.apiOutputPer1M,
					subscriberInputPer1M: m.subscriberInputPer1M,
					subscriberOutputPer1M: m.subscriberOutputPer1M,
					subscriberDiscountPercent: m.subscriberDiscountPercent,
				})),
			};
		}

		const wantsApiPrices = audience === "api";
		const showApi = wantsApiPrices || !subscriber;

		return {
			currency: table.currency,
			unit: table.unit,
			outputMultiplier: table.outputMultiplier,
			subscriber,
			/** True when these are list prices, i.e. not what this caller is charged. */
			listPrice: showApi,
			models: table.models.map((m) =>
				showApi
					? {
						modelKey: m.modelKey,
						label: m.label,
						inputPer1M: m.apiInputPer1M,
						outputPer1M: m.apiOutputPer1M,
					}
: {
							modelKey: m.modelKey,
							label: m.label,
							inputPer1M: m.subscriberInputPer1M,
							outputPer1M: m.subscriberOutputPer1M,
							// No discount percentage here, and deliberately so. The rate is already
							// what this caller pays, which is all any customer surface needs, and
							// stating the policy invites a client to depend on it. It is worth being
							// honest that this is tidiness rather than secrecy: anyone holding a
							// subscriber rate can divide it by the list rate and recover the
							// percentage exactly. The only audience that wants the figure stated is
							// the admin table, which asks for both columns at once.
						},
			),
		};
	}

	/**
 * What every plan includes per month, in RON.
 *
 * Public, because the plans page has to show what a plan is worth before anyone signs up
 * for one, and because it is the same number the backend charges against. Serving it from
 * the one table that does the charging is the point: the previous arrangement had the
 * allowance written out again on the subscription page, where it drifted and kept
 * advertising a prompt quota that had been deleted months earlier.
 */
@Get("allowances")
async getAllowances() {
	return {
		currency: "RON",
		per: "month",
		anonymousRon: ANONYMOUS_ALLOWANCE_RON,
		tiers: Object.entries(TIER_ALLOWANCE_RON).map(([tier, ron]) => ({ tier, allowanceRon: ron })),
	};
}

/** The signed-in account's balance and recent spend. */
	@UseGuards(JwtAuthGuard)
	@Get("balance")
	async getBalance(@Req() req: BillingRequest) {
		const accountId = this.requireAccountId(req);
		const balance = await this.billing.getBalance(accountId);
		const tier = await this.resolveTier(req);
		return {
			...balance,
			autoRefillTargetRon: AUTO_REFILL_TARGET_RON,
			maxBalanceRon: MAX_FUNDED_BALANCE_RON,
			allowance: await this.billing.getAllowance(accountId, tier),
			recent: await this.billing.recentUsage(accountId, 20),
		};
	}

	/** Whether this account may start another generation. Checked before the model runs. */
	@UseGuards(JwtAuthGuard)
	@Get("can-generate")
	async canGenerate(@Req() req: BillingRequest, @Query("modelKey") modelKey?: string) {
		const accountId = this.requireAccountId(req);
		const tier = await this.resolveTier(req);
		// One rule, in the service, covering both pots. This endpoint used to decide from the
		// wallet alone while *reporting* the hardcoded floor, so it contradicted itself --
		// and it refused accounts holding plenty of included allowance and no card balance.
		const state = await this.billing.canGenerate(accountId, tier);
		return {
			...state,
			// Echoed so a caller can say which model it asked about. Not a gate: every model
			// on the plan draws on the same money.
			modelKey: String(modelKey ?? ""),
		};
	}

	/**
	 * Record one generation's cost. Called by the Next layer after the model has run.
	 *
	 * Server-to-server, and deliberately not derived from anything the browser sends: the
	 * caller states the token counts the AI service reported and the price is resolved here.
	 * An endpoint that accepted a client-supplied `cost_ron` would be an endpoint that
	 * accepts a client-supplied zero.
	 *
	 * Anonymous callers are metered too, by fingerprint, against their own 3 RON allowance.
	 * The fingerprint is a client-supplied cookie and is treated as a courtesy budget, never
	 * as identity: it grants no access and buys nothing. Absent both a session and a
	 * fingerprint the request is refused rather than served free -- an unmetered caller
	 * would be an unlimited one.
	 *
	 * `requestId` makes this idempotent, because it runs after work already paid for in GPU
	 * time, which may legitimately be retried.
	 */
	// Optional, not absent: the guard always allows and only populates req.user when a live
	// session is presented, from either a Bearer token or the session cookie Next forwards.
	// Dropping it did not merely skip authentication -- it silently emptied req.user, so
	// every cookie-authenticated report fell through to the anonymous branch and 401'd.
	@Post("usage")
	@UseGuards(OptionalJwtAuthGuard)
	async recordUsage(
		@Req() req: BillingRequest & { headers?: Record<string, unknown> },
		@Body() body: Record<string, unknown>,
	) {
		const modelKey = String(body?.modelKey ?? "").trim();
		if (!modelKey) throw new BadRequestException("modelKey is required");

		const accountId = req.user?.id ? Number(req.user.id) : 0;
		// Resolved once, and only when it is actually needed. Absent is a 401 -- an
		// unmetered caller is an unlimited one. Present but malformed is a 400 from
		// parseFingerprint, never a silent repair.
		const fingerprint = accountId ? null : requireFingerprint(req);

		const inputTokens = Number(body?.inputTokens ?? 0);
		const outputTokens = Number(body?.outputTokens ?? 0);
		const requestId = body?.requestId ? String(body.requestId) : null;

		if (!accountId && fingerprint) {
			return this.billing.recordAnonymousUsage({
				fingerprint,
				modelKey,
				usage: { inputTokens, outputTokens },
				requestId,
			});
		}

		const tier = await this.resolveTier(req);
		const subscriber = isPaidTier(tier);

		// Which surface this came from decides both the rate and the pot.
		//
		// The caller states the scope; `resolveBillingContext` decides what follows from it
		// by reading the account's real entitlement. That split is deliberate -- letting the
		// caller choose its own pot would be the same mistake as accepting a client-supplied
		// cost_ron, one level up.
		const scope = body?.scope === "playground" ? "playground" : "kafelot";
		// Which product granted Playground access decides the pot. An add-on holder has no
		// included usage at all, even when their tier carries an allowance.
		const accessSource =
			scope === "playground"
				? (await this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier))).source
				: null;

		const context = resolveBillingContext({ scope, tier, accessSource, modelKey });

		const price = resolveTokenPrice(modelKey, context.priceMode);
		if (!price.known) {
			// Rejected, not charged zero. An unpriced model is a bug, and a zero-cost row
			// would bury it in an audit trail that otherwise looks complete.
			throw new BadRequestException(`unknown model: ${modelKey}`);
		}

		return this.billing.recordUsage({
			accountId,
			modelKey,
			subscriber,
			tier,
			requestId,
			usage: { inputTokens, outputTokens },
			scope,
			accessSource,
		});
	}

	/** An anonymous visitor's remaining allowance, for the window that shows it. */
	@Get("allowance/anonymous")
	async getAnonymousAllowance(@Req() req: BillingRequest & { headers?: Record<string, unknown> }) {
		return this.billing.getAnonymousAllowance(requireFingerprint(req));
	}

	/**
	 * This month's plan allowance: granted, spent, remaining, and when it resets.
	 *
	 * The number the Kafelot window shows. It replaced the prompt counter: this is money
	 * that works across every model, whereas a prompt count only ever described one.
	 */
	@UseGuards(JwtAuthGuard)
	@Get("allowance")
	async getAllowance(@Req() req: BillingRequest) {
		const accountId = this.requireAccountId(req);
		const tier = await this.resolveTier(req);
		return this.billing.getAllowance(accountId, tier);
	}

	/**
	 * Add money to the funded wallet with the default card.
	 *
	 * Spectre plans only (MAX and above). The wallet exists to extend the AI allowance, and
	 * the Playground that spends it is a MAX feature, so on any lower plan a top-up buys
	 * capacity for a product the account cannot reach. Allowing it would take a customer's
	 * money for something they cannot use, and the ceiling test would still pass.
	 *
	 * Refused with a 403 rather than a 400: nothing about the request is malformed, the
	 * account is simply not entitled to the thing being asked for.
	 *
	 * No payment provider: the charge is recorded, not settled. The response says how much
	 * was actually added, which can be less than asked for once the 1000 RON ceiling is in
	 * view -- taking the full amount anyway would leave a balance the customer cannot
	 * explain.
	 */
	@UseGuards(JwtAuthGuard)
	@Post("fund")
	async fund(@Req() req: BillingRequest, @Body() body: Record<string, unknown>) {
		const accountId = this.requireAccountId(req);
		const tier = await this.resolveTier(req);
		// The wallet funds the Spectre Playground, so it follows the same entitlement the
		// gate uses: the add-on, or a bundled Max/Ultimate tier. Resolved here rather than
		// from the tier alone, so an add-on holder on a low tier is not refused funding for
		// the product they just paid for.
		const access = await this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier));
		if (!access.hasAccess) {
			throw new ForbiddenException({
				error: "WALLET_REQUIRES_SPECTRE",
				message:
					"The AI wallet funds the Spectre Playground. Subscribe for 99.99 RON/month, or upgrade to MAX or ULTIMATE, to add funds.",
				currentTier: tier,
				requiredTiers: SPECTRE_TIERS_ALLOWED,
			});
		}
		const amount = Number(body?.amountRon);
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new BadRequestException("amountRon must be a positive number");
		}
		const cardId = await this.billing.defaultCardId(accountId);
		if (!cardId) {
			// Falling back to "no card" would mean silently minting money with nothing to
			// charge, so an account with no default card cannot fund.
			throw new BadRequestException("add a default card before funding the playground");
		}
		let result: { addedRon: number; balanceRon: number; capped: boolean };
		try {
			result = await this.billing.fund(accountId, amount, cardId, "user", body?.requestId ? String(body.requestId) : null);
		} catch (err) {
			// A refused charge is a payment outcome, not a server fault.
			//
			// Letting it surface as a 500 told the customer the site was broken when in fact
			// their card was declined, and told the monitoring that money was failing when it
			// was a decline doing exactly what declines do. The account page shows the
			// provider's own message either way, so nothing is lost.
			const code = (err as { code?: string } | null)?.code;
			const retryable = (err as { retryable?: boolean } | null)?.retryable === true;
			throw new HttpException(
				{
					error: code === "card_declined" ? "CARD_DECLINED" : "CHARGE_FAILED",
					message: err instanceof Error ? err.message : "The charge was not accepted.",
					retryable,
					balanceRon: (await this.billing.getBalance(accountId)).balanceRon,
				},
				retryable ? HttpStatus.BAD_GATEWAY : HttpStatus.PAYMENT_REQUIRED,
			);
		}
		return {
			...result,
			autoRefillTargetRon: AUTO_REFILL_TARGET_RON,
			maxBalanceRon: MAX_FUNDED_BALANCE_RON,
		};
	}

	/** The customer's own floor: 0 never goes negative, negative allows an overdraft. */
	@UseGuards(JwtAuthGuard)
	@Patch("min-balance")
	async setMinBalance(@Req() req: BillingRequest, @Body() body: Record<string, unknown>) {
		const accountId = this.requireAccountId(req);
		try {
			return await this.billing.setMinBalance(accountId, Number(body?.floorRon));
		} catch (err) {
			throw new BadRequestException(err instanceof Error ? err.message : "invalid floor");
		}
	}

	private requireAccountId(req: BillingRequest): number {
		const id = Number(req.user?.id);
		if (!Number.isInteger(id) || id <= 0) throw new UnauthorizedException("authentication required");
		return id;
	}

	/**
	 * Entitlement, read from `user_subscriptions` rather than the session claims.
	 *
	 * `req.user` carries id/email/username only, and the tier is a property of an active
	 * subscription row -- so it is read where it lives. It is also the one input here that
	 * must not be client-assertable, since it selects the price.
	 */
	private async resolveTier(req: BillingRequest): Promise<string> {
		const id = Number(req.user?.id);
		if (!Number.isInteger(id) || id <= 0) return "free";
		return this.kafelot.resolveTier(id);
	}
}

@Module({
	imports: [ConfigModule, DatabaseModule, forwardRef(() => KafelotModule)],
	controllers: [BillingController, AddonsController],
	providers: [
		BillingService,
		AddonsService,
		// The single seam where money would leave the building. Swapping this binding for a
		// real provider is the whole of the future payment work -- every caller already
		// depends on the interface and already handles a failed charge.
		{ provide: ChargeProvider, useClass: SimulatedChargeProvider },
	],
	// The charge seam is exported so the subscriptions module can renew and refund through
	// the same provider the wallet uses. Without that, renewals would need a second, parallel
	// payment path -- which is the duplication this binding exists to prevent.
	exports: [BillingService, ChargeProvider, AddonsService],
})
export class BillingModule {}
