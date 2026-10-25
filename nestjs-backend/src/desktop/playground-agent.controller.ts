import { Controller, Get, Header, Post, Req, Res, UseGuards, UnauthorizedException } from "@nestjs/common";
import { ExactPlaygroundBody } from "../common/pipes/exact-playground-body";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { BillingService } from "../billing/billing.service";
import { DesktopGatewayService } from "./desktop-gateway.service";

type Caller = { user?: { id?: number | string }; headers?: Record<string, unknown> };
function account(req: Caller): number {
	const value = Number(req.user?.id);
	if (!Number.isInteger(value) || value <= 0) throw new UnauthorizedException();
	return value;
}

/** Shared cookie/bearer surface; every POST is independently gated, metered and non-retryable. */
@Controller(["api/playground/agent", "api/desktop/agent"])
@UseGuards(JwtAuthGuard)
export class PlaygroundAgentController {
	constructor(private readonly billing: BillingService, private readonly gateway: DesktopGatewayService) {}

	@Get("capabilities")
	@Header("Cache-Control", "no-store")
	@Throttle({ default: { limit: 30, ttl: 60_000 } })
	capabilities(@Req() req: Caller) {
		account(req);
		return { version: 1, models: this.gateway.agentModels(), protocol: "native-v1", executesTools: false,
			interactionProtocols: ["question-v1"], conversationProtocol: "completed-turns-v1" };
	}

	@Post("turn")
	@Throttle({ default: { limit: 30, ttl: 60_000 } })
	async turn(@Req() req: Caller, @Res() res: Response, @ExactPlaygroundBody() body: unknown) {
		const id = account(req);
		res.setHeader("Cache-Control", "no-store");
		const controller = new AbortController(); const close = () => controller.abort();
		res.once("close", close);
		try {
			let tier: string;
			try { tier = await this.billing.resolveTierFor(id); }
			catch { if (!res.destroyed && !res.headersSent) res.status(503).json({ error: "BILLING_UNAVAILABLE", message: "Account billing could not be checked." }); return; }
			if (controller.signal.aborted || res.headersSent) return;
			// JWT bearer is the native client; cookies use the existing web billing scope.
			const scope = typeof req.headers?.authorization === "string" && req.headers.authorization.startsWith("Bearer ") ? "desktop" : "playground";
			const result = await this.gateway.agentTurn(id, tier, body, scope, controller.signal);
			if (res.destroyed || res.headersSent) return;
			if (result.requestId) res.setHeader("x-filspresso-request-id", result.requestId);
			if (result.kind === "refused") res.status(result.status).json({ error: result.error, message: result.message });
			else res.status(200).json(result.payload);
		} finally { res.removeListener("close", close); }
	}
}
