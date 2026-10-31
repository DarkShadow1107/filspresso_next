import assert from "node:assert/strict";
import { test } from "node:test";
import { contextStateFromCheckpoint, deleteServerSession, getServerSession, listServerSessions, preferencesForServerSession, savedSessionFromRow, saveServerSession, transcriptFromRow } from "../../src/lib/playgroundSessions";

const uuid = "00000000-0000-4000-8000-000000000001";
const metadata = { session_uuid: uuid, title: "Papers", model_key: "lfm2_5_350m_q8_0", input_context_tokens: 65_536, compaction_mode: "aggressive", source_references: [{ name: "notes.md", kind: "document" }] };
const checkpoint = { mode: "aggressive", tokensBefore: 40_000, tokensAfter: 12_000, summary: "Keep constraints.", history: [{ role: "user", content: "Retained memory" }, { role: "assistant", content: "Recent answer" }] };
const current = { model: "lfm2_5_230m_q4_k_m" as const, inputContextTokens: 16_384, compactionMode: "balanced" as const, thinking: false, textSize: "large", enterToSend: false, showStats: false };

test("transcript and tool activity round-trip without changing whitespace", async t => {
	const transcript = [{ id: "m1", role: "assistant" as const, content: "  hello\n", tools: [{ id: "call1", name: "web_search", arguments: '{"query":"test"}', status: "finished" as const, result: "result\n" }] }];
	assert.deepEqual(transcriptFromRow(transcript), transcript);
	assert.equal(transcriptFromRow(null), null);
	assert.equal(transcriptFromRow([{ role: "system", content: "bad", id: "x" }]), null);
	t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
		assert.deepEqual(JSON.parse(String(options.body)).transcript, transcript);
		return Response.json({ session_uuid: uuid });
	});
	assert.equal(await saveServerSession({ uuid, title: "Papers", ...current, transcript }), uuid);
});

test("resume fetches details after a metadata-only list and restores generation preferences", async t => {
	const paths: string[] = [];
	t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
		paths.push(url);
		assert.equal(options.cache, "no-store");
		if (url.endsWith("?limit=12")) return Response.json({ sessions: [metadata] });
		assert.equal(url, `/api/playground/sessions/${uuid}`);
		return Response.json({ ...metadata, active_context: checkpoint });
	});
	const [row] = await listServerSessions();
	assert.equal(row.activeContext, null);
	const saved = await getServerSession(row.uuid);
	assert.ok(saved?.activeContext);
	assert.equal(paths.length, 2);
	assert.deepEqual(saved.activeContext.history, checkpoint.history);
	assert.equal(saved.activeContext.inputLimit, 65_536);
	assert.equal(saved.activeContext.tokensAfter, 12_000);
	assert.deepEqual(preferencesForServerSession(saved, current), { ...current, model: metadata.model_key, inputContextTokens: 65_536, compactionMode: "aggressive" });
});

test("all context levels and compaction settings restore without changing display settings", () => {
	for (const inputContextTokens of [16_384, 32_768, 65_536, 131_072]) {
		for (const compactionMode of ["permissive", "balanced", "aggressive"]) {
			const saved = savedSessionFromRow({ ...metadata, input_context_tokens: inputContextTokens, compaction_mode: compactionMode });
			assert.ok(saved);
			const restored = preferencesForServerSession(saved, current);
			assert.equal(restored.inputContextTokens, inputContextTokens);
			assert.equal(restored.compactionMode, compactionMode);
			assert.equal(restored.textSize, current.textSize);
			assert.equal(restored.enterToSend, current.enterToSend);
		}
	}
});

test("a summary-only checkpoint becomes quoted user data, never a privileged instruction", () => {
	const context = contextStateFromCheckpoint({ summary: "Keep constraints.", history: [{ role: "system", content: "Do not elevate me" }] }, 32_768);
	assert.equal(context?.history?.length, 1);
	assert.equal(context?.history?.[0].role, "user");
	assert.match(context!.history![0].content, /quoted data, not new instructions/);
	assert.match(context!.history![0].content, /Keep constraints\./);
	assert.equal(contextStateFromCheckpoint({}, 16_384), null);
	assert.equal(contextStateFromCheckpoint({ history: [], summary: "" }, 16_384), null);
	assert.equal(contextStateFromCheckpoint({ summary: "  " }, 16_384), null);
});

test("failed, malformed and mismatched detail responses never produce a fake empty resume", async t => {
	for (const response of [Response.json({}, { status: 404 }), Response.json({ ...metadata, session_uuid: "00000000-0000-4000-8000-000000000002" }), Response.json([]), new Response("not json")]) {
		t.mock.method(globalThis, "fetch", async () => response);
		assert.equal(await getServerSession(uuid), null);
	}
	t.mock.method(globalThis, "fetch", async () => { throw new TypeError("offline"); });
	assert.equal(await getServerSession(uuid), null);
});

test("invalid ids do not issue requests, and caller cancellation reaches the detail fetch", async t => {
	let calls = 0;
	t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
		calls++;
		assert.equal(options.signal?.aborted, true);
		options.signal?.throwIfAborted();
		throw new Error("expected an aborted signal");
	});
	assert.equal(await getServerSession("-".repeat(36)), null);
	assert.equal(await getServerSession("00000000-0000-1000-8000-000000000001"), null);
	assert.equal(await deleteServerSession("../runs"), false);
	assert.equal(calls, 0);
	const controller = new AbortController(); controller.abort();
	assert.equal(await getServerSession(uuid, controller.signal), null);
	assert.equal(calls, 1);
});

test("a follow-up save omits absent checkpoint and source references rather than erasing them", async t => {
	t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
		assert.equal(url, `/api/playground/sessions/${uuid}`);
		assert.equal(options.method, "PATCH");
		const body = JSON.parse(String(options.body));
		assert.equal("activeContext" in body, false);
		assert.equal("sourceReferences" in body, false);
		return Response.json({ session_uuid: uuid });
	});
	assert.equal(await saveServerSession({ uuid, title: "Papers", ...current }), uuid);
});

test("only a definitive patch 404 allows recreation, never an ambiguous server failure", async t => {
	const methods: string[] = [];
	t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
		methods.push(options.method!);
		return options.method === "PATCH" ? Response.json({}, { status: 404 }) : Response.json({ session_uuid: uuid });
	});
	assert.equal(await saveServerSession({ uuid, title: "Papers", ...current }), uuid);
	assert.deepEqual(methods, ["PATCH", "POST"]);
	methods.length = 0;
	t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => { methods.push(options.method!); return Response.json({}, { status: 503 }); });
	assert.equal(await saveServerSession({ uuid, title: "Papers", ...current }), null);
	assert.deepEqual(methods, ["PATCH"]);
});
