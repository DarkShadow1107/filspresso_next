import { Body, Controller, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PlaygroundContextService } from "./playground-context.service";
import { Throttle } from "@nestjs/throttler";

@Controller("api/playground/context")
@UseGuards(JwtAuthGuard)
export class PlaygroundContextController {
	constructor(private readonly context: PlaygroundContextService) {}

	@Post("file")
	@Throttle({ default: { limit: 30, ttl: 60_000 } })
	@UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 } }))
	async file(@Req() req: Request & { user?: { id?: number } }, @Res({ passthrough: true }) res: Response, @UploadedFile() file: Express.Multer.File) {
		if (!file?.buffer?.length) throw new BadRequestException("Choose a non-empty file.");
		return this.withCancellation(res, (signal) => this.context.prepareFile(Number(req.user?.id), file.originalname, file.buffer, signal));
	}

	@Post("github")
	@Throttle({ default: { limit: 10, ttl: 60_000 } })
	async github(@Req() req: Request & { user?: { id?: number } }, @Res({ passthrough: true }) res: Response, @Body() body: { url?: unknown }) {
		if (typeof body?.url !== "string" || body.url.length > 300) throw new BadRequestException("Enter a GitHub repository URL.");
		return this.withCancellation(res, (signal) => this.context.prepareGithub(Number(req.user?.id), body.url as string, signal));
	}

	private async withCancellation<T>(res: Response, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const controller = new AbortController();
		const close = () => controller.abort();
		res.once("close", close);
		try { return await work(controller.signal); }
		finally { res.off("close", close); }
	}
}
