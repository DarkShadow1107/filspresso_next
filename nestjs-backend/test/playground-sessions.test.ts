import "./test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { DatabaseService } from "../src/database/database.service";
import { PlaygroundSessionsController } from "../src/desktop/playground-sessions.controller";
import type { PlaygroundRunEventsService } from "../src/desktop/playground-run-events.service";
import {
	PlaygroundSessionsService,
	normalizeActiveContext,
	normalizeClientSessionId,
	normalizeSessionWrite,
	normalizeSourceReferences,
	normalizeTranscript,
} from "../src/desktop/playground-sessions.service";

test("transcripts retain exact content and tool activity, and reject oversize writes", () => {
	const transcript = [{ id: "u1", role: "user", content: "  code\n\n" }, { id: "a1", role: "assistant", content: "done", tools: [{ id: "call1", name: "web_search", arguments: '{"query":"test"}', status: "finished", result: "ok\n" }] }];
	assert.deepEqual(normalizeTranscript(transcript), transcript);
	assert.deepEqual(normalizeSessionWrite({ transcript }).transcript, transcript);
	assert.throws(() => normalizeTranscript([{ id: "x", role: "system", content: "bad" }]));
	assert.throws(() => normalizeTranscript(Array.from({ length: 201 }, () => transcript[0])));
	assert.throws(() => normalizeTranscript([{ id: "x", role: "user", content: "x".repeat(700_001) }]));
});

test("transcript writes and reads remain account-scoped and lists remain metadata-only", async () => {
	const uuid = "00000000-0000-4000-8000-000000000001";
	const transcript = [{ id: "1", role: "assistant", content: "  exact\n", tools: [{ id: "c1", name: "read_file", arguments: "{}", status: "finished", result: "ok" }] }];
	const queries: Array<{ sql: string; params: unknown[] }> = [];
	const service = new PlaygroundSessionsService({ getPool: () => ({ connect: async () => ({
		query: async (sql: string, params: unknown[]) => {
			queries.push({ sql, params });
			if (sql.includes("COUNT(*)")) return { rows: [{ total: "1" }] };
			return { rows: [{ session_uuid: uuid, transcript }] };
		}, release() {},
	}) }) } as unknown as DatabaseService);
	await service.create(42, { transcript });
	assert.match(queries[0].sql, /transcript/);
	assert.equal(queries[0].params[0], 42);
	assert.deepEqual(JSON.parse(queries[0].params[8] as string), transcript);
	await service.update(42, uuid, { transcript });
	assert.match(queries[1].sql, /account_id = \$2/);
	assert.deepEqual(queries[1].params.slice(0, 2), [uuid, 42]);
	await service.get(42, uuid);
	assert.match(queries[2].sql, /transcript/);
	assert.deepEqual(queries[2].params, [uuid, 42]);
	await service.list(42);
	assert.doesNotMatch(queries[3].sql, /transcript/);
});

test("a checkpoint that is not an object is an empty one", () => {
	assert.deepEqual(normalizeActiveContext(undefined), {});
	assert.deepEqual(normalizeActiveContext("nope"), {});
	assert.deepEqual(normalizeActiveContext([1, 2]), {});
});

test("active context keeps only turns a live request could have accepted", () => {
	const valid = normalizeActiveContext({
		ids: ["a".repeat(65), "abc", 42],
		history: [
			{ role: "user", content: "hello" },
			{ role: "system", content: "smuggled" },
			{ role: "assistant", content: 5 },
			{ role: "user", content: { text: "object body" } },
		],
		mode: "aggressive",
		summary: "constraints: keep tone",
		tokensBefore: 9000.9,
		tokensAfter: -1,
	});
	// ids: over-length dropped, non-strings dropped.
	assert.deepEqual(valid.ids, ["abc"]);
	// history: the system turn and non-string bodies are gone, order kept.
	assert.deepEqual(valid.history, [{ role: "user", content: "hello" }]);
	assert.equal(valid.mode, "aggressive");
	assert.equal(valid.summary, "constraints: keep tone");
	assert.equal(valid.tokensBefore, 9000);
	assert.equal("tokensAfter" in valid, false);
});

test("a checkpoint over the context budget drops its oldest turns, not its newest", () => {
	// Six 150k turns are 900k in total, over the ceiling: the two oldest go, the four the
	// next request actually needs stay, in order.
	const turn = (char: string) => char.repeat(150_000);
	const compacted = normalizeActiveContext({
		history: ["a", "b", "c", "d", "e", "f"].map(char => ({ role: "user", content: turn(char) })),
	});
	const kept = compacted.history as Array<{ content: string }>;
	assert.equal(kept.length, 4);
	assert.equal(kept[0].content, turn("c"));
	assert.equal(kept[3].content, turn("f"));
	// An oversized single turn stops collection entirely -- a later turn is lost rather
	// than carried after half a conversation.
	const oversized = normalizeActiveContext({
		history: [{ role: "user", content: "keep" }, { role: "assistant", content: "y".repeat(200_001) }, { role: "user", content: "lost" }],
	});
	assert.deepEqual(oversized.history as Array<{ content: string }>, [{ role: "user", content: "keep" }]);
});

test("source references are named pointers, never bodies", () => {
	const references = normalizeSourceReferences([
		{ name: "spec.pdf", sourceUrl: "https://example.com/spec", kind: "document", size: 2048 },
		{ name: "bad", sourceUrl: "javascript:alert(1)" },
		{ name: 42 },
		null,
		"nope",
		{ sourceUrl: "ftp://files" },
		{ name: "relative", sourceUrl: "/etc/passwd" },
	]);
	// A scheme that is not a pointer is refused; the name survives, because silently
	// dropping a pointer the client did send would lose more than a bad URL.
	assert.deepEqual(references, [
		{ name: "spec.pdf", sourceUrl: "https://example.com/spec", kind: "document", size: 2048 },
		{ name: "bad" },
		{ name: "relative" },
	]);
	// An entry with no surviving field is not a reference at all.
	assert.deepEqual(normalizeSourceReferences([{}]), []);
	// More than the allowed set is a cap, not an error.
	const many = Array.from({ length: 20 }, (_, index) => ({ name: `s${index}` }));
	assert.equal(normalizeSourceReferences(many).length, 12);
});

test("session writes validate the money-adjacent fields and clamp the rest", () => {
	const write = normalizeSessionWrite({
		title: "  Papers and notes  ",
		model: "lfm2_5_8b_a1b_q4_k_m",
		inputContextTokens: 131_072,
		compactionMode: "permissive",
		activeContext: { history: [{ role: "user", content: "hi" }], tokensAfter: 42 },
		sourceReferences: [{ name: "notes.md", kind: "document" }],
	});
	assert.equal(write.title, "Papers and notes");
	assert.equal(write.modelKey, "lfm2_5_8b_a1b_q4_k_m");
	assert.equal(write.inputContextTokens, 131_072);
	assert.equal(write.compactionMode, "permissive");
	assert.deepEqual((write.activeContext as Record<string, unknown>).history, [{ role: "user", content: "hi" }]);
	assert.deepEqual(write.sourceReferences, [{ name: "notes.md", kind: "document" }]);

	// Everything unknown: an empty write changes nothing -- callers that send `{}` on a
	// PATCH get back the row as it stands.
	assert.deepEqual(normalizeSessionWrite({}), {});
});

test("a write that names an unavailable model or level throws, and the controller turns it into a 400", () => {
	assert.throws(() => normalizeSessionWrite({ model: "gptnine-omni" }), /not available in the Playground/);
	assert.throws(() => normalizeSessionWrite({ inputContextTokens: 10_000 }), /16K, 32K, 64K or 128K/);
	// A numeric string at a real level passes, exactly the same coercion the live request
	// validates with -- the two surfaces cannot disagree.
	assert.equal(
		normalizeSessionWrite({ inputContextTokens: "131072" } as never).inputContextTokens,
		131_072,
	);
	assert.throws(() => normalizeSessionWrite({ compactionMode: "medium" }), /Permissive, Balanced or Aggressive/);
	// Whitespace-only is not a name.
	assert.deepEqual(normalizeSessionWrite({ title: "   " }), {});
});

test("a client-supplied session id follows the same v4-only rule as the server's own", () => {
	assert.equal(normalizeClientSessionId("00000000-0000-4000-8000-000000000000"), "00000000-0000-4000-8000-000000000000");
	assert.equal(normalizeClientSessionId("00000000-0000-1000-8000-000000000000"), null);
	assert.equal(normalizeClientSessionId(undefined), null);
});

test("session lists stay metadata-only while detail reads return the account-scoped checkpoint", async () => {
	const uuid = "00000000-0000-4000-8000-000000000001";
	const row = { session_uuid: uuid, title: "Papers", active_context: { history: [{ role: "user", content: "Retained memory" }] } };
	const queries: Array<{ sql: string; params: unknown[] }> = [];
	const service = new PlaygroundSessionsService({ getPool: () => ({ connect: async () => ({
		query: async (sql: string, params: unknown[]) => {
			queries.push({ sql, params });
			if (sql.includes("COUNT(*)")) return { rows: [{ total: "1" }] };
			if (sql.includes("LIMIT $2")) {
				assert.doesNotMatch(sql, /active_context/);
				return { rows: [{ session_uuid: uuid, title: "Papers" }] };
			}
			assert.match(sql, /active_context/);
			assert.match(sql, /account_id = \$2 AND is_active = TRUE/);
			assert.deepEqual(params, [uuid, 42]);
			return { rows: [row] };
		}, release() {},
	}) }) } as unknown as DatabaseService);
	const controller = new PlaygroundSessionsController(service, {} as PlaygroundRunEventsService);
	assert.deepEqual((await controller.list({ user: { id: 42 } }, "12")).sessions, [{ session_uuid: uuid, title: "Papers" }]);
	assert.deepEqual(await controller.get({ user: { id: 42 } }, uuid), row);
	assert.deepEqual(queries[0].params, [42, 12, 0]);
});

test("invalid writes are 400s, but missing rows remain 404s and infrastructure errors are not relabeled", async () => {
	const uuid = "00000000-0000-4000-8000-000000000001";
	let failure: Error | null = null;
	const service = new PlaygroundSessionsService({ getPool: () => ({ connect: async () => ({
		query: async () => { if (failure) throw failure; return { rows: [] }; }, release() {},
	}) }) } as unknown as DatabaseService);
	const controller = new PlaygroundSessionsController(service, {} as PlaygroundRunEventsService);
	const req = { user: { id: 42 } };
	await assert.rejects(controller.create(req, { compactionMode: "medium" }), BadRequestException);
	await assert.rejects(controller.update(req, uuid, { inputContextTokens: 7 }), BadRequestException);
	await assert.rejects(controller.update(req, uuid, { title: "Gone" }), NotFoundException);
	await assert.rejects(controller.get(req, uuid), NotFoundException);
	failure = new Error("synthetic database failure");
	await assert.rejects(controller.update(req, uuid, { title: "Papers" }), error => error === failure);
});
