import { BadRequestException, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ExactPlaygroundBody } from "../common/pipes/exact-playground-body";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PlaygroundSandboxService } from "./playground-sandbox.service";

type Caller = { user?: { id?: number | string } };
function identity(value: string) {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new BadRequestException("Invalid sandbox ID");
	return value;
}

@Controller("api/playground/sandbox")
@UseGuards(JwtAuthGuard)
export class PlaygroundSandboxController {
	constructor(private readonly sandboxes: PlaygroundSandboxService) {}
	@Get()
	health(@Req() req: Caller) { return this.sandboxes.request(Number(req.user?.id), "GET", "/health"); }
	@Post()
	@Throttle({ default: { limit: 6, ttl: 60_000 } })
	create(@Req() req: Caller) { return this.sandboxes.request(Number(req.user?.id), "POST", "/sandboxes"); }
	@Delete(":id")
	stop(@Req() req: Caller, @Param("id") id: string) { return this.sandboxes.request(Number(req.user?.id), "DELETE", `/sandboxes/${identity(id)}`); }
	@Get(":id/files")
	files(@Req() req: Caller, @Param("id") id: string) { return this.sandboxes.request(Number(req.user?.id), "GET", `/sandboxes/${identity(id)}/files`); }
	@Get(":id/file")
	read(@Req() req: Caller, @Param("id") id: string, @Query("path") path: string) {
		if (typeof path !== "string" || path.length > 240) throw new BadRequestException("Invalid workspace path");
		return this.sandboxes.request(Number(req.user?.id), "GET", `/sandboxes/${identity(id)}/file?${new URLSearchParams({ path })}`);
	}
	@Put(":id/file")
	write(@Req() req: Caller, @Param("id") id: string, @ExactPlaygroundBody() body: { path?: unknown; text?: unknown }) {
		if (typeof body?.path !== "string" || body.path.length > 240 || typeof body.text !== "string" || Buffer.byteLength(body.text) > 256 * 1024) throw new BadRequestException("Choose a workspace path and UTF-8 text no larger than 256 KiB");
		return this.sandboxes.request(Number(req.user?.id), "PUT", `/sandboxes/${identity(id)}/file`, { path: body.path, text: body.text });
	}
	@Post(":id/run")
	@Throttle({ default: { limit: 12, ttl: 60_000 } })
	async run(@Req() req: Caller, @Param("id") id: string, @ExactPlaygroundBody() body: { command?: unknown; approved?: unknown }, @Res() res: Response) {
		if (typeof body?.command !== "string" || !body.command.trim() || body.command.length > 4000 || body.approved !== true) throw new BadRequestException("Review a command and explicitly approve execution");
		return this.sandboxes.run(Number(req.user?.id), identity(id), { command: body.command, approved: true, timeoutSeconds: 30 }, res);
	}
}
