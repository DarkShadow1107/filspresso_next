import { Body, Controller, Post, Req, Res, UseGuards, BadRequestException, ForbiddenException, HttpException, ServiceUnavailableException } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { BillingService } from "../billing/billing.service";
import { AddonsService } from "../billing/addons.service";
import { canUseSpectre } from "../billing/tier-allowance";
import { desktopModelAccess } from "./desktop-policy";
import { playgroundModelFile } from "./text-models";
import { DesktopGatewayService } from "./desktop-gateway.service";
import { fetchBounded } from "../common/utils/httpClient";

type Caller = { user?: { id?: number | string } };

/** Cookie and bearer clients share the same authoritative Playground gate/meter. */
@Controller("api/playground")
@UseGuards(JwtAuthGuard)
export class PlaygroundController {
	constructor(private readonly billing: BillingService, private readonly addons: AddonsService, private readonly gateway: DesktopGatewayService) {}

	@Post("chat/stream")
	async chat(@Req() req: Caller, @Res() res: Response, @Body() body: Record<string, unknown>) {
		const accountId = Number(req.user?.id);
		const tier = await this.billing.resolveTierFor(accountId);
		const result = await this.gateway.streamChat(res, accountId, tier, body ?? {}, "playground");
		if (result.kind === "refused") res.status(result.status).json({ error: result.error, message: result.message });
	}

	@Post("models/load")
	@Throttle({ default: { limit: 12, ttl: 60_000 } })
	async load(@Req() req: Caller, @Body() body: { model?: unknown }) {
		const modelKey = typeof body?.model === "string" ? body.model : "";
		const file = playgroundModelFile(modelKey);
		if (!file) throw new BadRequestException({ error: "UNKNOWN_MODEL", message: "Choose an available model." });
		try {
			const accountId = Number(req.user?.id);
			const tier = await this.billing.resolveTierFor(accountId);
			const access = await this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier));
			if (!access.hasAccess) throw new ForbiddenException({ error: "PLAYGROUND_LOCKED" });
			const [wallet, allowance] = await Promise.all([this.billing.getBalance(accountId), this.billing.getAllowance(accountId, tier)]);
			if (!desktopModelAccess({ modelKey, tier, accessSource: access.source, walletCanGenerate: wallet.canGenerate, allowanceRemainingRon: allowance.remainingRon }).canGenerate)
				throw new HttpException({ error: "INSUFFICIENT_BALANCE", message: "This model needs available allowance or wallet credit." }, 402);
		} catch (error) {
			if (error instanceof HttpException) throw error;
			throw new ServiceUnavailableException({ error: "BILLING_UNAVAILABLE" });
		}
		try {
			const host = (process.env.PYTHON_AI_HOST || "http://ai:5000").replace(/\/+$/, "");
			const key = process.env.AI_SERVICE_KEY?.trim();
			const response = await fetchBounded(`${host}/api/warmup`, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "x-ai-service-key": key } : {}) },
				body: JSON.stringify({ model: file, vision: modelKey.includes("_vl_") }), timeoutMs: 10_000, maxBytes: 64_000 });
			const data = await response.json();
			if (!response.ok) throw new ServiceUnavailableException({ error: "AI_UNAVAILABLE" });
			return data;
		} catch (error) {
			if (error instanceof HttpException) throw error;
			throw new ServiceUnavailableException({ error: "AI_UNAVAILABLE" });
		}
	}
}
