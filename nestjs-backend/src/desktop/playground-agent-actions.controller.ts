import { Controller, Get, Header, Param, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ExactPlaygroundBody } from "../common/pipes/exact-playground-body";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PlaygroundAgentActionsService } from "./playground-agent-actions.service";

type Caller = { user?: { id?: string | number } };
const account = (req: Caller) => { const id = Number(req.user?.id); if (!Number.isSafeInteger(id) || id <= 0) throw new UnauthorizedException(); return id; };

@Controller("api/playground/agent/actions")
@UseGuards(JwtAuthGuard)
export class PlaygroundAgentActionsController {
	constructor(private readonly actions: PlaygroundAgentActionsService) {}
	@Get("capabilities")
	@Header("Cache-Control", "no-store")
	@Throttle({ default: { limit: 30, ttl: 60_000 } })
	capabilities(@Req() req: Caller) { return this.actions.capabilities(account(req)); }
	@Post()
	@Header("Cache-Control", "no-store")
	@Throttle({ default: { limit: 60, ttl: 60_000 } })
	prepare(@Req() req: Caller, @Res({ passthrough: true }) res: Response, @ExactPlaygroundBody() body: unknown) {
		return this.cancellable(res, signal => this.actions.prepare(account(req), body, signal));
	}
	@Post(":id/execute")
	@Header("Cache-Control", "no-store")
	@Throttle({ default: { limit: 60, ttl: 60_000 } })
	execute(@Req() req: Caller, @Res({ passthrough: true }) res: Response, @Param("id") id: string, @ExactPlaygroundBody() body: unknown) {
		return this.cancellable(res, signal => this.actions.execute(account(req), id, body, signal));
	}
	private async cancellable<T>(res: Response, operation: (signal: AbortSignal) => Promise<T>) {
		const controller = new AbortController(); const close = () => controller.abort();
		res.once("close", close); const timer = setTimeout(close, 90_000);
		try { return await operation(controller.signal); }
		finally { clearTimeout(timer); res.removeListener("close", close); }
	}
}
