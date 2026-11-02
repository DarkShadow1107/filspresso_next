import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { EXPORT_MIME, exportDocument, type ExportFormat } from "./playground-document-export";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { InvalidDocumentInputError, PlaygroundDocumentsService } from "./playground-documents.service";

type Caller = { user?: { id?: number | string } };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function accountId(req: Caller): number {
	const parsed = Number(req.user?.id);
	if (!Number.isInteger(parsed) || parsed <= 0) throw new BadRequestException("Authentication is required.");
	return parsed;
}

function documentId(id: string): string {
	if (!UUID_PATTERN.test(id)) throw new BadRequestException("Invalid document id.");
	return id;
}

/**
 * Account-scoped Playground documents.
 *
 * Jwt-guarded because every row belongs to one account, and every mutation is throttled
 * below the chat route's ceiling: a runaway client that saved a reply every keystroke
 * would otherwise make this table a write target for a stream that never ends.
 */
@Controller("api/playground/documents")
@UseGuards(JwtAuthGuard)
export class PlaygroundDocumentsController {
	constructor(private readonly documents: PlaygroundDocumentsService) {}

	@Get()
	list(@Req() req: Caller, @Query("limit") limit?: string) {
		return this.documents.list(accountId(req), Number(limit));
	}

	@Post()
	@Throttle({ default: { limit: 12, ttl: 60_000 } })
	create(@Req() req: Caller, @Body() body: Record<string, unknown>) {
		return this.wrapping(() => this.documents.create(accountId(req), { name: body?.name, content: body?.markdown ?? body?.content }));
	}

	@Get(":uuid")
	get(@Req() req: Caller, @Param("uuid") uuid: string) {
		return this.documents.get(accountId(req), documentId(uuid));
	}

	@Get(":uuid/export/:format")
	@Throttle({ default: { limit: 12, ttl: 60_000 } })
	async export(@Req() req: Caller, @Param("uuid") uuid: string, @Param("format") format: string, @Res() res: Response) {
		if (!Object.hasOwn(EXPORT_MIME, format)) throw new BadRequestException("Unsupported document format.");
		const row = await this.documents.get(accountId(req), documentId(uuid));
		const bytes = await exportDocument(row.name as string, row.content as string, format as ExportFormat);
		res.setHeader("Content-Type", EXPORT_MIME[format as ExportFormat]);
		res.setHeader("Content-Disposition", `attachment; filename="document.${format}"`);
		res.setHeader("Cache-Control", "private, no-store");
		res.send(bytes);
	}

	@Delete(":uuid")
	delete(@Req() req: Caller, @Param("uuid") uuid: string) {
		return (async () => {
			const removed = await this.documents.delete(accountId(req), documentId(uuid));
			return removed ? { message: "Document deleted" } : { message: "Document not found" };
		})();
	}

	/** One shared shape for the client-facing refusal, so the stream path and this route agree. */
	private async wrapping(operation: () => Promise<unknown>): Promise<unknown> {
		try {
			return await operation();
		} catch (error) {
			if (error instanceof InvalidDocumentInputError) throw new BadRequestException({ error: "INVALID_DOCUMENT", message: error.message });
			throw error;
		}
	}
}
