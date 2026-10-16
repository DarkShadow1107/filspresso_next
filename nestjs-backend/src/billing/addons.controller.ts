import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AddonsService, SPECTRE_ADDON_SUMMARY } from "./addons.service";
import { BillingService } from "./billing.service";
import { canUseSpectre } from "./tier-allowance";

interface AddonRequest {
  user?: Record<string, unknown>;
}

function accountIdOf(req: AddonRequest): number {
  const id = Number(req.user?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException({ error: "ACCOUNT_REQUIRED" });
  }
  return id;
}

/**
 * The Spectre Playground add-on.
 *
 * Public on purpose for the summary: the plans page has to quote the price to someone who
 * has not signed up, exactly as the tier table is public.
 */
@Controller("api/spectre")
export class AddonsController {
  constructor(
    private readonly addons: AddonsService,
    private readonly billing: BillingService,
  ) {}

  /** What the product is and what it costs. No authentication. */
  @Get("subscription")
  getSubscription() {
    return SPECTRE_ADDON_SUMMARY;
  }

  /**
   * Whether this account may use the Playground, and why.
   *
   * A single endpoint because the frontend used to re-derive this from the tier in four
   * separate places, which is four chances to disagree with the gate. Now the gate and the
   * UI read the same answer.
   */
  @UseGuards(JwtAuthGuard)
  @Get("access")
  async access(@Req() req: AddonRequest) {
    const accountId = accountIdOf(req);
    const tier = await this.billing.resolveTierFor(accountId);
    return this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier));
  }

  @UseGuards(JwtAuthGuard)
  @Post("subscribe") @HttpCode(HttpStatus.CREATED)
  async subscribe(@Req() req: AddonRequest, @Body() body: Record<string, unknown>) {
    const accountId = accountIdOf(req);
    const cycle = String(body?.billingCycle || "monthly");
    const cardId = await this.billing.defaultCardId(accountId);
    return this.addons.purchase(
      accountId,
      cycle === "annual" ? "annual" : "monthly",
      cardId,
    );
  }

  /** Cancels, keeping access until the period already paid for ends. */
  @UseGuards(JwtAuthGuard)
  @Put("cancel") @HttpCode(HttpStatus.OK)
  async cancel(@Req() req: AddonRequest) {
    return this.addons.cancel(accountIdOf(req));
  }

  @UseGuards(JwtAuthGuard)
  @Get("subscriptions")
  async list(@Req() req: AddonRequest) {
    return { addons: await this.addons.listForAccount(accountIdOf(req)) };
  }
}