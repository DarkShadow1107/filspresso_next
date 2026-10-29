import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { DatabaseService } from "../database/database.service";

/**
 * Server-saved documents for the Playground chat.
 *
 * A document is created either by the model (a fenced block the stream path detects after
 * generation) or by the user (an explicit save of a reply). Both end here, on the backend,
 * behind the caller's own account scope -- that is the whole security property: nothing is
 * published, nothing is shared, nothing is servable to an anonymous caller, and the only
 * download path re-reads through the owner's own session.
 *
 * ## Bounds are enforced here, not hoped for
 *
 * A chat model can loop. A name can be 120 KB of spaces. So the caps live in the insert
 * path: name and body length, a per-account document count (new writes are refused at the
 * limit, never delete existing documents), and every row is stamped
 * with the body digest so an honest "what is actually stored" answer is one column away.
 */

export const MAX_DOCUMENT_NAME_LENGTH = 120;
export const MAX_DOCUMENT_CONTENT_LENGTH = 200_000;
export const MAX_DOCUMENTS_PER_ACCOUNT = 64;
export const MAX_DOCUMENT_LIST = 50;

export type DocumentRow = { id: string; name: string; mime: string; contentBytes: number; createdAt: string };

export class InvalidDocumentInputError extends Error {}

/** The write the caller is allowed to make. Raw `unknown` in, exact shapes out. */
export type DocumentWrite = { name: unknown; content: unknown; runId?: unknown };

function clampDocumentName(value: unknown): string {
	if (typeof value !== "string") throw new InvalidDocumentInputError("A document needs a name.");
	const cleaned = value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
	if (!cleaned) throw new InvalidDocumentInputError("A document needs a name.");
	return cleaned.slice(0, MAX_DOCUMENT_NAME_LENGTH);
}

@Injectable()
export class PlaygroundDocumentsService {
	constructor(private readonly db: DatabaseService) {}

	async create(accountId: number, write: DocumentWrite): Promise<Record<string, unknown>> {
		if (!Number.isInteger(accountId) || accountId <= 0) throw new InvalidDocumentInputError("Authentication is required.");
		const name = clampDocumentName(write.name);
		if (typeof write.content !== "string") throw new InvalidDocumentInputError("A document needs a markdown body.");
		if (write.content.length > MAX_DOCUMENT_CONTENT_LENGTH) throw new InvalidDocumentInputError("The document exceeds the size limit; nothing was saved.");
		const content = write.content;
		if (!content.trim()) throw new InvalidDocumentInputError("The document body is empty.");
		const bytes = Buffer.byteLength(content, "utf8");
		const sha256 = bodySha256(content);
		const runId = typeof write.runId === "string" && /^[a-zA-Z0-9-]{1,48}$/.test(write.runId) ? write.runId : null;
		const client = await this.db.getPool().connect();
		try {
			await client.query("BEGIN");
			await client.query("SELECT pg_advisory_xact_lock($1, $2)", [0x504744, accountId]);
			const count = await client.query("SELECT COUNT(*)::int AS count FROM playground_documents WHERE account_id = $1", [accountId]);
			if (Number(count.rows[0]?.count) >= MAX_DOCUMENTS_PER_ACCOUNT) throw new InvalidDocumentInputError("Document storage is full. Delete a document before saving another.");
			const result = await client.query(
				`INSERT INTO playground_documents (id, account_id, name, content, content_bytes, body_sha256, run_id)
				 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
				 RETURNING id::text, name, mime, content_bytes, created_at`,
				[accountId, name, content, bytes, sha256, runId],
			);
			const row = result.rows[0];
			await client.query("COMMIT");
			return row;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally { client.release(); }
	}

	async list(accountId: number, limit = 20): Promise<{ version: number; documents: Array<Record<string, unknown>> }> {
		if (!Number.isInteger(accountId) || accountId <= 0) return { version: 1, documents: [] };
		const safeLimit = Math.min(Math.max(Number.isInteger(limit) && limit > 0 ? limit : 20, 1), MAX_DOCUMENT_LIST);
		const client = await this.db.getPool().connect();
		try {
			// Metadata only. The body is served by the single-document route, so a listing
			// of sixty rows cannot become a megabyte response nobody asked for.
			const result = await client.query(
				`SELECT id::text, name, mime, content_bytes, created_at
				 FROM playground_documents WHERE account_id = $1
				 ORDER BY created_at DESC, id DESC LIMIT $2`,
				[accountId, safeLimit],
			);
			return { version: 1, documents: result.rows };
		} finally { client.release(); }
	}

	async get(accountId: number, uuid: string): Promise<Record<string, unknown>> {
		const client = await this.db.getPool().connect();
		try {
			const result = await client.query(
				`SELECT id::text, name, content, mime, content_bytes, body_sha256, run_id, created_at
				 FROM playground_documents WHERE account_id = $1 AND id = $2::uuid LIMIT 1`,
				[accountId, uuid],
			);
			if (!result.rows.length) throw new NotFoundException({ error: "DOCUMENT_NOT_FOUND" });
			return result.rows[0];
		} finally { client.release(); }
	}

	async delete(accountId: number, uuid: string): Promise<boolean> {
		const client = await this.db.getPool().connect();
		try {
			const result = await client.query(
				"DELETE FROM playground_documents WHERE account_id = $1 AND id = $2::uuid",
				[accountId, uuid],
			);
			return (result.rowCount ?? 0) > 0;
		} finally { client.release(); }
	}
}

/** SHA-256 of the stored body. Certifying what came back later, not authenticating it. */
function bodySha256(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}
