/**
 * Shared bounded search-result sanitization and document extraction helpers.
 *
 * The legacy grounding formatting helpers below are retained for compatibility tests only;
 * the gateway no longer invokes them. Web searches now use the agent action boundary.
 * - Documents are detected in the finished answer as a fenced block. The fence is parsed
 *   server-side after the frame that ends the generation, and only exact, bounded matches
 *   are saved -- anything that does not parse stays visible in the chat as ordinary text
 *   and is never silently rewritten.
 *
 * Both helpers are pure on purpose: the stream path is hard to test, and these are the parts
 * that would corrupt a user's data if they drifted.
 */

export const MAX_WEB_QUERY_LENGTH = 512;
export const MAX_WEB_GROUNDING_RESULTS = 5;
/** One search-result snippet. Five of these plus headers must stay well under one prompt. */
export const MAX_WEB_SNIPPET_LENGTH = 400;
export const MAX_WEB_RESULT_TITLE = 160;
export const MAX_WEB_RESULT_URL = 480;
export const MAX_WEB_GROUNDED_PROMPT = 8_000;

export type WebSearchResult = { title: string; url: string; snippet: string };

/**
 * The client asks for grounding; the server alone decides to do it. `true` or the string
 * "true" -- exactly the same strictness the `thinking` flag's boolean shape uses downstream.
 */
export function webResearchRequested(body: Record<string, unknown>): boolean {
	return body?.web_research === true || body?.web_research === "true";
}

/** Sanitized copy of one search hit, or nothing: a malformed hit is dropped, not guessed. */
export function sanitizeSearchResult(raw: unknown): WebSearchResult | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const candidate = raw as Record<string, unknown>;
	const title = typeof candidate.title === "string" ? candidate.title.trim().slice(0, MAX_WEB_RESULT_TITLE) : "";
	const url = typeof candidate.url === "string" ? candidate.url.trim().slice(0, MAX_WEB_RESULT_URL) : "";
	const snippet = typeof candidate.snippet === "string" ? candidate.snippet.trim().slice(0, MAX_WEB_SNIPPET_LENGTH) : "";
	let publicLink = false;
	try {
		const parsed = new URL(url);
		publicLink = (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
	} catch { /* A malformed URL is not a source. */ }
	// A url is the one field grounding is useless without: text without a source is just
	// the model talking, and quoting it as a search result would be a lie.
	if (!publicLink) return null;
	return { title: title || url, url, snippet };
}

/**
 * The sources frame the client renders as citation chips. Clamped a second time here
 * because this shape crosses the stream to a browser as JSON.
 */
export function sanitizeSearchResults(raw: unknown): WebSearchResult[] {
	const list = Array.isArray(raw) ? raw : [];
	const results: WebSearchResult[] = [];
	for (const item of list) {
		const sanitized = sanitizeSearchResult(item);
		if (sanitized) results.push(sanitized);
		if (results.length >= MAX_WEB_GROUNDING_RESULTS) break;
	}
	return results;
}

/**
 * The system-prompt augmentation one grounded turn carries.
 *
 * The date is stated so a model trained years ago can route around stale knowledge. The
 * numbered sources are quoted data -- they are context, shown to the model exactly like
 * the attached-source blocks -- and the instruction to cite them is what makes the answer
 * auditable: the user clicks a chip and lands on the page the claim came from.
 */
export function buildWebGroundedPrompt(query: string, results: WebSearchResult[], searchedOn: string): string {
	const dated = /^\d{4}-\d{2}-\d{2}$/.test(searchedOn) ? searchedOn : new Date().toISOString().slice(0, 10);
	const blocks = results.map((result, index) =>
		`[${index + 1}] ${result.title}\n${result.url}\n${result.snippet || "(no snippet)"}`,
	);
	const affection = results.length
		? "Answer the user's question. When a statement relies on one of the numbered results, cite it inline as [n]. If the results do not cover the question, answer from what you know and say what you are unsure about. Never present the sources' words as your own casing of the user's request."
		: "The search found no usable result for this question. Answer from what you know, and say plainly that your answer may be out of date.";
	return [
		`Web research was performed before this reply.`,
		`Today's date: ${dated}.`,
		`Search query (the user's message): ${query.slice(0, MAX_WEB_QUERY_LENGTH)}`,
		`Search results:`,
		blocks.join("\n"),
		affection,
	].join("\n");
}

/** The clamps one streamed answer's grounding block obeys; the full prompt stays bounded. */
export function boundGroundedSystemPrompt(systemPrompt: string, groundingBlock: string): string {
	const combined = `${systemPrompt}\n\n<web-grounding>\n${groundingBlock}\n</web-grounding>`;
	return combined.slice(0, MAX_WEB_GROUNDED_PROMPT);
}

export const MAX_COMPOSED_SYSTEM_PROMPT = 10_000;

/** Append a conversational-instruction block without the grounding wrapper. */
export function appendBoundedSystemPrompt(systemPrompt: string, block: string): string {
	const combined = systemPrompt ? `${systemPrompt}\n\n${block}` : block;
	return combined.slice(0, MAX_COMPOSED_SYSTEM_PROMPT);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const MAX_DOCUMENTS_PER_REPLY = 3;
export const MAX_DOCUMENT_NAME = 120;
export const MAX_DOCUMENT_CONTENT = 200_000;
export const DOCUMENT_MIME = "text/markdown";

/**
 * The fence the model is asked to write, and the only one the server honours:
 *
 *   [[document: Spare parts review]]
 *   ...markdown...
 *   [[/document]]
 *
 * A single-line opener keeps the regex deterministic for a small model; `[[` cannot
 * appear in ordinary prose by accident.
 */
export const DOCUMENT_OPEN_PATTERN = /\[\[document:\s*([^\][\n]{1,180})\]\]/g;
export const DOCUMENT_CLOSE_TOKEN = "[[/document]]";

export type ExtractedDocument = { name: string; content: string; bytes: number };

function clampDocumentName(raw: string): string {
	const name = raw.replace(/\s+/g, " ").trim();
	if (!name) return "";
	// Control characters never belong in a title the UI renders back.
	const cleaned = name.replace(/[\x00-\x1f\x7f]/g, "").trim();
	return cleaned.slice(0, MAX_DOCUMENT_NAME);
}

/**
 * Every fenced document in one answer. Rules:
 *
 * - A document must be closed with an exact `[[/document]]`. An opener without its closer
 *   is ordinary chat text and is ignored -- truncating the fence occurs when output hits
 *   its token cap, and saving half a document labelled as complete would be a lie.
 * - First stop wins: everything between the opener and the FIRST closer is the content,
 *   so a nested or repeated closer cannot balloon the capture.
 * - Content length is capped before the model's text is copied anywhere. An oversized
 *   document is dropped, not truncated: a silent half-document is worse than no document,
 *   and the cap is large enough that hitting it means the model looped, not wrote.
 */
export function extractPlaygroundDocuments(answer: string): ExtractedDocument[] {
	if (typeof answer !== "string") return [];
	const documents: ExtractedDocument[] = [];
	for (const match of answer.matchAll(DOCUMENT_OPEN_PATTERN)) {
		const name = clampDocumentName(match[1] ?? "");
		if (!name) continue;
		const openerEnd = (match.index ?? 0) + match[0].length;
		const closeIndex = answer.indexOf(DOCUMENT_CLOSE_TOKEN, openerEnd);
		if (closeIndex === -1) continue;
		const content = answer.slice(openerEnd, closeIndex).replace(/^\r?\n/, "").replace(/\r?\n[ \t]*$/, "");
		if (!content.trim()) continue;
		if (content.length > MAX_DOCUMENT_CONTENT) continue;
		documents.push({ name, content, bytes: Buffer.byteLength(content, "utf8") });
		if (documents.length >= MAX_DOCUMENTS_PER_REPLY) break;
	}
	return documents;
}
