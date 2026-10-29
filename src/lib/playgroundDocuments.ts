/**
 * Client access to the server's account-scoped Playground documents (see
 * `nestjs-backend/src/desktop/playground-documents.service.ts`, proxied through
 * `/api/playground/documents`).
 *
 * A document is markdown the model produced inside a `[[document: …]]` fence during a chat
 * reply, or a reply the user explicitly saved. It lives on the backend, keyed to the signed-in
 * account — nothing here publishes it, and the download is the user's own browser re-reading
 * the row they own and handing it to their own disk.
 *
 * Every call is fail-open like the sessions lib: a lost document list or save is an
 * enhancement that failed, never an error that costs the conversation.
 */

const SAVE_LIMIT_MS = 8_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_DOCUMENT_NAME = 120;

export type PlaygroundDocumentRef = {
	id: string;
	name: string;
	mime: string;
	contentBytes: number;
	createdAt: string;
};

export type PlaygroundDocument = PlaygroundDocumentRef & {
	content: string;
};

export type DocumentFrame = { id: string; name: string; bytes: number };

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function refFromRow(row: unknown): PlaygroundDocumentRef | null {
	if (!isRecord(row) || typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) return null;
	const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Untitled document";
	const bytes = Number(row.content_bytes);
	return {
		id: row.id,
		name: name.slice(0, MAX_DOCUMENT_NAME),
		mime: typeof row.mime === "string" && row.mime ? row.mime : "text/markdown",
		contentBytes: Number.isFinite(bytes) && bytes >= 0 ? Math.floor(bytes) : 0,
		createdAt: typeof row.created_at === "string" ? row.created_at : "",
	};
}

/** The account's saved documents, newest first; empty (not an error) when unavailable. */
export async function listDocuments(limit = 24): Promise<PlaygroundDocumentRef[]> {
	try {
		const response = await fetch(`/api/playground/documents?limit=${Math.min(Math.max(limit, 1), 50)}`, { cache: "no-store", signal: AbortSignal.timeout(SAVE_LIMIT_MS) });
		if (!response.ok) return [];
		const payload = await response.json().catch(() => null) as { documents?: unknown } | null;
		if (!payload || !Array.isArray(payload.documents)) return [];
		return payload.documents.map(refFromRow).filter((row): row is PlaygroundDocumentRef => row !== null);
	} catch { return []; }
}

/** Create a document. Returns the stored row, or null when the backend refused or was away. */
export async function createDocument(name: string, markdown: string): Promise<PlaygroundDocumentRef | null> {
	try {
		const response = await fetch("/api/playground/documents", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, markdown }),
			signal: AbortSignal.timeout(SAVE_LIMIT_MS),
		});
		if (!response.ok) return null;
		return refFromRow(await response.json().catch(() => null));
	} catch { return null; }
}

/** Download one document through the user's own session, as a local markdown file. */
export async function downloadDocument(uuid: string, name: string): Promise<string | null> {
	if (!UUID_PATTERN.test(uuid)) return null;
	try {
		const response = await fetch(`/api/playground/documents/${encodeURIComponent(uuid)}`, { cache: "no-store", signal: AbortSignal.timeout(SAVE_LIMIT_MS * 4) });
		if (!response.ok) return "The document could not be downloaded. Please retry.";
		const row = await response.json().catch(() => null) as { content?: unknown;mime?: unknown } | null;
		if (!isRecord(row) || typeof row.content !== "string") return "The document came back empty. Please retry.";
		const blob = new Blob([row.content], { type: `${typeof row.mime === "string" && row.mime ? row.mime : "text/markdown"};charset=utf-8` });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = fileNameFor(name);
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
		return null;
	} catch { return "The document could not be downloaded. Please retry."; }
}

/** Delete one document. True only when the backend says so. */
export async function deleteDocument(uuid: string): Promise<boolean> {
	if (!UUID_PATTERN.test(uuid)) return false;
	try {
		const response = await fetch(`/api/playground/documents/${encodeURIComponent(uuid)}`, { method: "DELETE", signal: AbortSignal.timeout(SAVE_LIMIT_MS) });
		return response.ok;
	} catch { return false; }
}

function fileNameFor(name: string): string {
	const safe = name.replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_DOCUMENT_NAME);
	return `${safe || "document"}.md`;
}
