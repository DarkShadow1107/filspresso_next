import { strict as assert } from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Response as ExpressResponse } from "express";
import { EventEmitter } from "node:events";
import { BillingService } from "../src/billing/billing.service";
import { AddonsService } from "../src/billing/addons.service";
import { DesktopGatewayService } from "../src/desktop/desktop-gateway.service";
import { PlaygroundDocumentsService } from "../src/desktop/playground-documents.service";
import { PLAYGROUND_DOCUMENTS_SCHEMA } from "../src/desktop/playground-documents.schema";
import { buildWebGroundedPrompt, boundGroundedSystemPrompt, extractPlaygroundDocuments, sanitizeSearchResults,
	webResearchRequested } from "../src/desktop/playground-chat-tools";

class Reply extends EventEmitter {
	body = "";
	destroyed = false;
	headersSent = false;
	status() { return this; }
	setHeader() { return this; }
	flushHeaders() { this.headersSent = true; }
	write(value: string) { this.body += value; return true; }
	end() {}
}

function funded(charges: Array<Record<string, unknown>>, web?: unknown, documents?: unknown) {
	const billing = { getBalance: async () => ({ canGenerate: true }), getAllowance: async () => ({ remainingRon: 100 }), recordUsage: async (value: Record<string, unknown>) => { charges.push(value); } } as unknown as BillingService;
	const addons = { resolveSpectreAccess: async () => ({ hasAccess: true, source: "tier" }) } as unknown as AddonsService;
	return new DesktopGatewayService(billing, addons, undefined, undefined, web as never, documents as never);
}

function upstreamFrames(frames: unknown[]): Response {
	const wire = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("");
	return new Response(wire, { headers: { "Content-Type": "text/event-stream" } });
}

const MODEL = { model: "lfm2_5_230m_q4_k_m", message: "What changed in browsers this month?" };
const WEB_MODEL = { ...MODEL, web_research: true };

test("the web research flag is strict, like the thinking flag", () => {
	assert.equal(webResearchRequested({ web_research: true }), true);
	assert.equal(webResearchRequested({ web_research: "true" }), true);
	assert.equal(webResearchRequested({ web_research: false }), false);
	assert.equal(webResearchRequested({ web_research: 1 }), false);
	assert.equal(webResearchRequested({}), false);
});

test("search results are clamped twice and malformed hits are dropped, not guessed", () => {
	const results = sanitizeSearchResults([
		{ title: "  A browser post  ", url: "https://example.com/post", snippet: "x".repeat(5000) },
		{ title: "No url", snippet: "nothing" },
		{ url: "https://example.com/real", snippet: "b" },
		{ url: "javascript:alert(1)", title: "unsafe" },
	]);
	assert.equal(results.length, 2);
	assert.equal(results[0].snippet.length, 400);
	assert.equal(results[0].title, "A browser post");
	assert.equal(results[1].title, "https://example.com/real");
	assert.equal(sanitizeSearchResults("nope").length, 0);
	assert.equal(sanitizeSearchResults([{ url: "https://a", snippet: "1", title: "T" }, ...Array.from({ length: 9 }, (_, i) => ({ url: `https://b/${i}` }))]).length, 5);
});

test("the grounded prompt is dated, numbered and cites", () => {
	const prompt = buildWebGroundedPrompt("new html feature", [{ title: "T", url: "https://x/y", snippet: "S" }], "2026-10-29");
	assert.match(prompt, /Web research was performed before this reply\./);
	assert.match(prompt, /2026-10-29/);
	assert.match(prompt, /new html feature/);
	assert.match(prompt, /\[1\] T\nhttps:\/\/x\/y\nS/);
	assert.match(prompt, /cite it inline as \[n\]/);
	const empty = buildWebGroundedPrompt("q", [], "2026-10-29");
	assert.match(empty, /found no usable result/);
});

test("the grounding block is wrapped and the whole system prompt stays bounded", () => {
	const combined = boundGroundedSystemPrompt("be helpful", "ground");
	assert.match(combined, /be helpful\n\n<web-grounding>\nground\n<\/web-grounding>/);
	assert.equal(boundGroundedSystemPrompt("", "g".repeat(20_000)).length, 8_000);
});

test("document fences parse exactly: unclosed, empty, oversized and extra documents are refused", () => {
	const good = extractPlaygroundDocuments("Intro.\n[[document: Weekly report]]\n# Report\nBody text.\n[[/document]]\nOutro.");
	assert.equal(good.length, 1);
	assert.equal(good[0].name, "Weekly report");
	assert.equal(good[0].content, "# Report\nBody text.");
	assert.ok(good[0].bytes > 0);
	// Unclosed fence: probably a truncated answer; never saved as a complete document.
	assert.equal(extractPlaygroundDocuments("[[document: Half]]\nbody with no close").length, 0);
	// Empty body is not a document.
	assert.equal(extractPlaygroundDocuments("[[document: Empty]]\n\n[[/document]]").length, 0);
	// Name is collapsed and control characters cannot survive into the UI.
	const messy = extractPlaygroundDocuments("[[document:   A  \nbad\x01name  ]]x[[/document]]");
	assert.ok(messy.length && messy[0].name === "A bad name" || messy.length === 0, `got ${JSON.stringify(messy)}`);
	// Count cap of three.
	const many = extractPlaygroundDocuments(Array.from({ length: 5 }, (_, i) => `[[document: D${i}]]b${i}[[/document]]`).join(" "));
	assert.equal(many.length, 3);
	// Oversized content is dropped, not truncated.
	const big = extractPlaygroundDocuments(`[[document: Big]]${"x".repeat(200_001)}[[/document]]`);
	assert.equal(big.length, 0);
	assert.equal(extractPlaygroundDocuments(undefined as never as string).length, 0);
});

test("removed web grounding rejects legacy requests without searching or generating", async () => {
	const charges: Array<Record<string, unknown>> = [];
	let searched = false;
	const web = { search: async () => { searched = true; return []; } };
	const result = await funded(charges, web).streamChat(new Reply() as unknown as ExpressResponse, 42, "max", WEB_MODEL, "playground");
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.error, "WEB_GROUNDING_REMOVED");
	assert.equal(searched, false);
	assert.equal(charges.length, 0);
});

test("a fenced document in a playground reply is stored once and announced before done", async () => {
	const charges: Array<Record<string, unknown>> = [];
	const creations: Array<{ name?: unknown; content?: unknown }> = [];
	const documents = { create: async (account: number, write: { name: string; content: string }) => {
		creations.push({ name: write.name, content: write.content });
		return { id: "11111111-1111-4111-8111-111111111111", name: write.name, content_bytes: 42 };
	} };
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async () => upstreamFrames([
		{ delta: "Short chat text. [[document: Meeting notes]]" },
		{ delta: "\n# Agenda\n- item one\n" },
		{ delta: "[[/document]]" },
		{ done: true, usage: { prompt_tokens: 30, completion_tokens: 12 } },
	]);
	try {
		const res = new Reply();
		assert.equal((await funded(charges, undefined, documents).streamChat(res as unknown as ExpressResponse, 42, "max", MODEL, "playground")).kind, "sent");
		assert.deepEqual(creations, [{ name: "Meeting notes", content: "# Agenda\n- item one" }]);
		assert.match(res.body, /"document":\{"id":"11111111-1111-4111-8111-111111111111","name":"Meeting notes","bytes":42\}/);
		assert.ok(res.body.indexOf('"document"') >= 0 && res.body.indexOf('"document"') < res.body.lastIndexOf('"done":true'), res.body);
		assert.equal(charges.length, 1);
	} finally { globalThis.fetch = previousFetch; }
});

test("a document save failure never retracts the answer; it notices and keeps going", async () => {
	const charges: Array<Record<string, unknown>> = [];
	const documents = { create: async () => { throw new Error("db down"); } };
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async () => upstreamFrames([
		{ delta: "[[document: X]]body[[/document]]" },
		{ done: true, usage: { prompt_tokens: 30, completion_tokens: 12 } },
	]);
	try {
		const res = new Reply();
		assert.equal((await funded(charges, undefined, documents).streamChat(res as unknown as ExpressResponse, 42, "max", MODEL, "playground")).kind, "sent");
		assert.match(res.body, /could not be saved to your account/);
		assert.equal(charges.length, 1);
	} finally { globalThis.fetch = previousFetch; }
});

test("desktop scope never stores reply documents, and its prompt carries no document instruction", async () => {
	const charges: Array<Record<string, unknown>> = [];
	const creations: Array<unknown> = [];
	const documents = { create: async (account: number, write: { name: string }) => { creations.push(write); return { id: "2", name: write.name, content_bytes: 1 }; } };
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async (_url, init) => {
		const parsed = JSON.parse(String(init!.body)) as { system_prompt: string };
		assert.equal(parsed.system_prompt.includes("[[document:"), false);
		return upstreamFrames([
			{ delta: "[[document: X]]body[[/document]]" },
			{ done: true, usage: { prompt_tokens: 30, completion_tokens: 12 } },
		]);
	};
	try {
		const res = new Reply();
		assert.equal((await funded(charges, undefined, documents).streamChat(res as unknown as ExpressResponse, 42, "max", MODEL, "desktop")).kind, "sent");
		assert.deepEqual(creations, []);
		assert.equal(res.body.includes('"document"'), false);
	} finally { globalThis.fetch = previousFetch; }
});

test("the documents service rejects oversized content and scopes every statement to the account", async () => {
	const created: Array<{ sql: string; values: unknown[] }> = [];
	const pool = {
		query: async (sql: string, values: unknown[] = []) => {
			created.push({ sql, values: [...values] });
			if (sql.startsWith("INSERT")) return { rows: [{ id: "uuid-1", name: values[1], mime: "text/markdown", content_bytes: 7, created_at: "now" }] };
			return { rowCount: 0, rows: [] };
		},
	};
	const service = new PlaygroundDocumentsService({ getPool: () => ({ connect: async () => ({ query: pool.query, release() {} }) }) } as never);
	await assert.rejects(service.create(42, { name: "Big", content: "x".repeat(200_001) }), /size limit/);
	const row = await service.create(42, { name: "  My \nreport ", content: "# Report" });
	const inserted = created.find(entry => entry.sql.startsWith("INSERT"))!;
	assert.equal(inserted.values[0], 42);
	assert.equal(inserted.values[1], "My report");
	assert.equal(inserted.values[2], "# Report");
	assert.ok(!created.some(entry => entry.sql.startsWith("DELETE")));
	assert.equal(row.name, "My report");
	// Name absence is a refusal the controller can shape.
	await assert.rejects(service.create(42, { name: "   ", content: "x" }), /name/);
	await assert.rejects(service.create(0, { name: "A", content: "x" }), /Authentication/);
	await assert.rejects(service.get(42, "00000000-0000-4000-8000-000000000000"), /DOCUMENT_NOT_FOUND|not found|Not Found/i);
	const listed = await service.list(42, 999);
	assert.equal(listed.documents.length, 0);
});

test("bootstrap and SQL migration share the same documents schema", () => {
	const migration = readFileSync(join(__dirname, "../data/migrations/2026-10-playground-documents.sql"), "utf8").replace(/^--.*$/gm, "").replace(/\r\n/g, "\n").trim();
	assert.equal(migration, PLAYGROUND_DOCUMENTS_SCHEMA.replace(/\r\n/g, "\n").trim());
	assert.match(migration, /REFERENCES accounts\(id\) ON DELETE CASCADE/);
	assert.match(migration, /idx_playground_documents_account/);
});
