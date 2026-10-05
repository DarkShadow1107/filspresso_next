import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Module,
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
import { KafelotModule } from "../kafelot/kafelot.module";
import { KafelotService } from "../kafelot/kafelot.service";
import { BillingService, MIN_BALANCE_RON } from "./billing.service";
import { pricingTable, resolveTokenPrice } from "./model-pricing";

interface BillingRequest {
	user?: { id?: number | string } | undefined;
}

/** Tiers that get the subscriber rate. `none` and `free` pay list price. */
const FREE_TIERS = new Set(["", "none", "free"]);

@Controller("api/billing")
export class BillingController {
	constructor(
		private readonly billing: BillingService,
		private readonly kafelot: KafelotService,
	) {}

	/**
	 * The price list, for the model picker and the admin table.
	 *
	 * Public, because prices are not secret and the picker renders them before anyone has
	 * signed in. A subscriber is sent exactly one price -- theirs. Sending both and letting
	 * the client choose would hand the list price to precisely the accounts least entitled
	 * to see it, and would make the displayed number a client-side decision about money.
	 */
	@UseGuards(OptionalJwtAuthGuard)
	@Get("pricing")
	async getPricing(@Req() req: BillingRequest) {
		const tier = await this.resolveTier(req);
		const subscriber = !FREE_TIERS.has(tier);
		const table = pricingTable();

		return {
			currency: table.currency,
			unit: table.unit,
			outputMultiplier: table.outputMultiplier,
			subscriber,
			models: table.models.map((m) =>
				subscriber
					? {
						modelKey: m.modelKey,
						label: m.label,
						inputPer1M: m.subscriberInputPer1M,
						outputPer1M: m.subscriberOutputPer1M,
						subscriberDiscountPercent: m.subscriberDiscountPercent,
					}
					: {
						modelKey: m.modelKey,
						label: m.label,
						inputPer1M: m.apiInputPer1M,
						outputPer1M: m.apiOutputPer1M,
					},
			),
		};
	}

	/** The signed-in account's balance and recent spend. */
	@UseGuards(JwtAuthGuard)
	@Get("balance")
	async getBalance(@Req() req: BillingRequest) {
		const accountId = this.requireAccountId(req);
		const balance = await this.billing.getBalance(accountId);
		return { ...balance, recent: await this.billing.recentUsage(accountId, 20) };
	}

	/** Whether this account may start another generation. Checked before the model runs. */
	@UseGuards(JwtAuthGuard)
	@Get("can-generate")
	async canGenerate(@Req() req: BillingRequest, @Query("modelKey") modelKey?: string) {
		const accountId = this.requireAccountId(req);
		const balance = await this.billing.getBalance(accountId);
		return {
			canGenerate: balance.canGenerate,
			balanceRon: balance.balanceRon,
			minBalanceRon: MIN_BALANCE_RON,
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
	 * `requestId` makes this idempotent, because it runs after work already paid for in GPU
	 * time, which may legitimately be retried.
	 */
	@UseGuards(JwtAuthGuard)
	@Post("usage")
	async recordUsage(@Req() req: BillingRequest, @Body() body: Record<string, unknown>) {
		const accountId = this.requireAccountId(req);
		const modelKey = String(body?.modelKey ?? "").trim();
		if (!modelKey) throw new BadRequestException("modelKey is required");

		const subscriber = !FREE_TIERS.has(await this.resolveTier(req));
		const price = resolveTokenPrice(modelKey, subscriber);
		if (!price.known) {
			// Rejected, not charged zero. An unpriced model is a bug, and a zero-cost row
			// would bury it in an audit trail that otherwise looks complete.
			throw new BadRequestException(`unknown model: ${modelKey}`);
		}

		return this.billing.recordUsage({
			accountId,
			modelKey,
			subscriber,
			requestId: body?.requestId ? String(body.requestId) : null,
			usage: {
				inputTokens: Number(body?.inputTokens ?? 0),
				outputTokens: Number(body?.outputTokens ?? 0),
			},
		});
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
	imports: [ConfigModule, DatabaseModule, KafelotModule],
	controllers: [BillingController],
	providers: [BillingService],
	exports: [BillingService],
})
export class BillingModule {}
