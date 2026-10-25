import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { nativeAgentModels, nativeAgentTurn, parseNativeAgentReply, type NativeAgentRequest } from "../../src/lib/playgroundAgent";

const fixture = JSON.parse(readFileSync("tests/fixtures/playground-agent.json", "utf8"));
const request = fixture.request as NativeAgentRequest;

test("native capabilities are read-only and proposal POSTs are no-store, not automatic execution", async t => {
	const methods: string[] = [];
	t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
		methods.push(init.method!); assert.equal(init.cache, "no-store");
		if (init.method === "GET") return Response.json({ version: 1, models: [], protocol: "native-v1", executesTools: false });
		assert.deepEqual(JSON.parse(String(init.body)), request); return Response.json(fixture.reply);
	});
	assert.deepEqual(await nativeAgentModels(), []);
	assert.deepEqual((await nativeAgentTurn(request)).tool_calls, fixture.reply.tool_calls);
	assert.deepEqual(methods, ["GET", "POST"]);
});

test("code/XML-looking answer text is inert text, never a tool-call fallback", () => {
	const text = '<tool_call>{"name":"run_command"}</tool_call>\n```sh\nwhoami\n```';
	const result = parseNativeAgentReply({ ...fixture.reply, text, finish_reason: "stop", tool_calls: [] }, request);
	assert.equal(result.text, text); assert.deepEqual(result.tool_calls, []);
});

test("unknown versions, incomplete turns, failed settlements and invalid arguments fail closed", () => {
	for (const patch of [{ version: 2 }, { settlement: "failed" }, { usage: null }, { finish_reason: "length" }, { runId: "client-id" },
		{ tool_calls: [...fixture.reply.tool_calls, ...fixture.reply.tool_calls] },
		{ tool_calls: [{ ...fixture.reply.tool_calls[0], name: "unknown" }] },
		...['{"path":"a","path":"b"}', '{"path":2}', '{"path":"a","extra":true}', '{"path":"\\uD800"}'].map(argumentsJson => ({ tool_calls: [{ ...fixture.reply.tool_calls[0], arguments: argumentsJson }] }))])
		assert.throws(() => parseNativeAgentReply({ ...fixture.reply, ...patch }, request));
});

test("refusals and lost responses never retry a billable POST", async t => {
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: "BILLING_UNAVAILABLE" }, { status: 503 }); });
	await assert.rejects(nativeAgentTurn(request), /No automatic retry/); assert.equal(calls, 1);
});

test("cancellation during a stalled body propagates and cancels its reader", async t => {
	let cancelled = false; const controller = new AbortController();
	t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
	const pending = nativeAgentTurn(request, controller.signal); controller.abort();
	await assert.rejects(pending, error => error instanceof Error && error.name === "AbortError");
	assert.equal(cancelled, true);
});

test("request and response byte ceilings reject rather than silently dropping tool pairs", async t => {
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("x".repeat(1_048_577)); });
	await assert.rejects(nativeAgentTurn({ ...request, message: "x".repeat(1_048_577) }), /No tool pairs/); assert.equal(calls, 0);
	await assert.rejects(nativeAgentTurn(request), /byte limit/); assert.equal(calls, 1);
});
