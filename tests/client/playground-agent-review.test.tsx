import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { NativeProposalReview, buildProposalReview, proposalReviewTools, isReviewWorkspacePath } from "../../src/lib/playgroundAgentReview";
import type { NativeAgentReply, NativeAgentRequest } from "../../src/lib/playgroundAgent";
import PlaygroundAgentReview, { AgentProposalCard } from "../../src/components/playground/PlaygroundAgentReview";

const fixture = JSON.parse(readFileSync("tests/fixtures/playground-agent.json", "utf8"));
const model = fixture.request.model as string;
const context = { model, inputContextTokens: 16_384 };
const good = (): NativeAgentReply => structuredClone(fixture.reply);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("review starts closed and capability checks never generate paid turns", async () => {
	let checks = 0; let posts = 0;
	const review = new NativeProposalReview({ models: async () => { checks++; return []; }, turn: async () => { posts++; return good(); } });
	await review.generate(context, "plan", "Inspect."); assert.equal(posts, 0);
	await review.refresh(); assert.equal(checks, 1); assert.deepEqual(review.getSnapshot().models, []);
	await review.generate(context, "build", "Change a file."); assert.equal(posts, 0); assert.equal(review.getSnapshot().result, null);
});

test("fixed Plan/Build registries never constitute execution authority or invented results", () => {
	assert.deepEqual(proposalReviewTools("plan").map(tool => [tool.name, tool.effect]), [["read_file", "read_only"]]);
	assert.deepEqual(proposalReviewTools("build").map(tool => tool.name), ["read_file", "write_file", "run_command"]);
	const request = buildProposalReview({ ...context, sessionUuid: "00000000-0000-4000-8000-000000000001" }, "build", "  Propose a fix.  ");
	assert.equal(request.message, "Propose a fix."); assert.deepEqual(request.history, []);
	assert.match(request.system_prompt!, /No workspace is connected/); assert.equal("approved" in request, false);
	assert.throws(() => request.tools.push(request.tools[0]));
	assert.throws(() => Object.assign(request.tools[0].parameters, { additionalProperties: true }));
});

test("one explicit generation has one immutable receipt and never automatically follows up", async () => {
	let posts = 0; const sent: NativeAgentRequest[] = [];
	const review = new NativeProposalReview({ models: async () => [model], turn: async request => { posts++; sent.push(request); return good(); } });
	await review.refresh(); await review.generate(context, "plan", "Inspect.");
	const result = review.getSnapshot().result!;
	assert.equal(review.getSnapshot().phase, "complete"); assert.equal(posts, 1); assert.deepEqual(sent[0].history, []);
	assert.equal(result.reply.runId, fixture.reply.runId); assert.equal(result.reply.settlement, "succeeded");
	assert.throws(() => result.reply.tool_calls.push(result.reply.tool_calls[0]));
	review.clear(); assert.equal(review.getSnapshot().result, null); assert.equal(posts, 1);
});

test("double clicks do not issue parallel paid turns and cancellation discards a late response", async () => {
	const pending = deferred<NativeAgentReply>(); let posts = 0;
	const review = new NativeProposalReview({ models: async () => [model], turn: async () => { posts++; return pending.promise; } });
	await review.refresh(); const first = review.generate(context, "plan", "Inspect.");
	await review.generate(context, "plan", "Duplicate."); assert.equal(posts, 1);
	review.clear(); const cleared = review.getSnapshot(); await first;
	pending.resolve(good()); await Promise.resolve();
	assert.equal(review.getSnapshot(), cleared); assert.equal(review.getSnapshot().result, null);
});

test("capability refreshes are single-flight and cannot replace an active paid turn", async () => {
	const capabilities = deferred<string[]>(); const reply = deferred<NativeAgentReply>(); let checks = 0; let posts = 0;
	const review = new NativeProposalReview({ models: () => { checks++; return capabilities.promise; }, turn: () => { posts++; return reply.promise; } });
	const checking = review.refresh(); await review.refresh(); await review.generate(context, "plan", "Too soon.");
	assert.equal(checks, 1); assert.equal(posts, 0);
	capabilities.resolve([model]); await checking;
	const generating = review.generate(context, "build", "Propose a fix."); await review.refresh();
	assert.equal(checks, 1); assert.equal(posts, 1); assert.equal(review.getSnapshot().phase, "generating");
	reply.resolve(good()); await generating; assert.equal(review.getSnapshot().phase, "complete");
});

test("cancellation from a state notification prevents dispatch before it starts", async () => {
	let checks = 0; let posts = 0;
	const review = new NativeProposalReview({ models: async () => { checks++; return [model]; }, turn: async () => { posts++; return good(); } });
	let stop = review.subscribe(() => { if (review.getSnapshot().phase === "checking") review.clear(true); });
	await review.refresh(); assert.equal(checks, 0); stop();
	await review.refresh();
	stop = review.subscribe(() => { if (review.getSnapshot().phase === "generating") review.clear(); });
	await review.generate(context, "plan", "Inspect."); assert.equal(posts, 0); assert.equal(review.getSnapshot().result, null); stop();
});

test("a cancelled turn cannot overwrite or unlock a newer active turn", async () => {
	const old = deferred<NativeAgentReply>(); const next = deferred<NativeAgentReply>(); let posts = 0;
	const review = new NativeProposalReview({ models: async () => [model], turn: () => ++posts === 1 ? old.promise : next.promise });
	await review.refresh(); const first = review.generate(context, "plan", "Old."); review.clear();
	const second = review.generate(context, "plan", "New."); await first; old.resolve(good()); await Promise.resolve();
	await review.generate(context, "plan", "Duplicate new."); assert.equal(posts, 2); assert.equal(review.getSnapshot().phase, "generating");
	next.resolve({ ...good(), text: "New answer." }); await second;
	assert.equal(review.getSnapshot().result?.request.message, "New."); assert.equal(review.getSnapshot().result?.reply.text, "New answer.");
});

test("Build proposals and answer-only replies remain single-turn inert results", async () => {
	const calls = [{ id: "write_1", name: "write_file", arguments: '{"path":"src/main.py","text":"print(1)"}' },
		{ id: "run_1", name: "run_command", arguments: '{"command":"python3 src/main.py"}' }];
	let reply = { ...good(), tool_calls: calls }; let posts = 0;
	const review = new NativeProposalReview({ models: async () => [model], turn: async () => { posts++; return reply; } });
	await review.refresh(); await review.generate(context, "build", "Propose a change and test.");
	assert.deepEqual(review.getSnapshot().result?.reply.tool_calls, calls); assert.equal(posts, 1);
	reply = { ...good(), text: "```sh\necho not-executed\n```", tool_calls: [], finish_reason: "stop" };
	await review.generate(context, "plan", "Explain only."); assert.equal(posts, 2);
	assert.equal(review.getSnapshot().phase, "complete"); assert.deepEqual(review.getSnapshot().result?.reply.tool_calls, []);
	assert.deepEqual(review.getSnapshot().result?.request.history, []);
});

test("bounded timeouts fail visibly, release busy state, and never retry", async t => {
	let timeout = new AbortController(); let checks = 0; let posts = 0;
	t.mock.method(AbortSignal, "timeout", () => timeout.signal);
	const review = new NativeProposalReview({ models: () => { checks++; return new Promise(() => {}); }, turn: () => { posts++; return new Promise(() => {}); } });
	const checking = review.refresh(); timeout.abort(new Error("Capability deadline.")); await checking;
	assert.equal(checks, 1); assert.equal(review.getSnapshot().phase, "failed"); assert.deepEqual(review.getSnapshot().models, []);
	timeout = new AbortController();
	const available = new NativeProposalReview({ models: async () => [model], turn: () => { posts++; return new Promise(() => {}); } });
	await available.refresh(); const generating = available.generate(context, "plan", "Inspect.");
	timeout.abort(new Error("Generation deadline.")); await generating;
	assert.equal(posts, 1); assert.equal(available.getSnapshot().phase, "failed"); assert.equal(available.getSnapshot().result, null);
	timeout = new AbortController(); const retry = available.generate(context, "plan", "Explicit retry.");
	assert.equal(posts, 2); available.clear(); await retry;
});

test("account/context reset clears capabilities and stale capability responses cannot re-enable them", async () => {
	const pending = deferred<string[]>(); let posts = 0;
	const review = new NativeProposalReview({ models: () => pending.promise, turn: async () => { posts++; return good(); } });
	const checking = review.refresh(); review.clear(true, "Account changed."); await checking;
	pending.resolve([model]); await Promise.resolve();
	assert.deepEqual(review.getSnapshot().models, []);
	await review.generate(context, "build", "Propose a change."); assert.equal(posts, 0);
});

test("unsupported capabilities and failed refreshes discard cached availability", async () => {
	let models = [model];
	const review = new NativeProposalReview({ models: async () => models, turn: async () => good() });
	await review.refresh(); assert.deepEqual(review.getSnapshot().models, [model]);
	models = ["lfm2_5_vl_450m_q4_k_m"]; await review.refresh();
	assert.equal(review.getSnapshot().phase, "failed"); assert.deepEqual(review.getSnapshot().models, []);
});

test("invalid, unsettled, out-of-mode and unsafe-path proposals never become reviewable", async () => {
	let reply = good();
	const review = new NativeProposalReview({ models: async () => [model], turn: async () => reply }); await review.refresh();
	for (const patch of [{ settlement: "failed" }, { version: 2 }, { tool_calls: [{ ...good().tool_calls[0], name: "run_command", arguments: '{"command":"whoami"}' }] },
		{ tool_calls: [{ ...good().tool_calls[0], arguments: '{"path":"../escape"}' }] }]) {
		reply = { ...good(), ...patch } as NativeAgentReply; await review.generate(context, "plan", "Inspect.");
		assert.equal(review.getSnapshot().phase, "failed"); assert.equal(review.getSnapshot().result, null);
	}
});

test("invalid contexts, models and prompts fail without changing generation preferences", () => {
	for (const invalid of [{ ...context, inputContextTokens: 2000 }, { ...context, model: "lfm2_5_audio_1_5b_q4_0" }, { ...context, sessionUuid: "../other" }])
		assert.throws(() => buildProposalReview(invalid, "plan", "Inspect."));
	assert.throws(() => buildProposalReview(context, "plan", "x".repeat(8001)));
	assert.throws(() => buildProposalReview(context, "plan", "\uD800"));
	assert.equal(context.inputContextTokens, 16_384);
});

test("review path policy rejects traversal and Windows aliases even on the web", () => {
	for (const path of ["../file", "/absolute", "C:/Windows", "file:stream", "src\\file", "NUL.txt", "COM1.txt", "CONOUT$", "src/file.", "src/file ", "a//b"])
		assert.equal(isReviewWorkspacePath(path), false, path);
	assert.equal(isReviewWorkspacePath("src/quoted'file.py"), true);
});

test("proposal cards escape argument markup and execution approval is always disabled", () => {
	const html = renderToStaticMarkup(<AgentProposalCard call={{ id: "call_1", name: "run_command", arguments: '{"command":"<script>alert(1)</script>"}' }} />);
	assert.doesNotMatch(html, /<script|onclick=/i); assert.match(html, /&lt;script&gt;/);
	assert.match(html, /Proposed, not executed/); assert.match(html, /<button[^>]*disabled=""[^>]*>Execution approval unavailable/);
});

test("opening/rendering review neither requests inference nor enables the generate button", t => {
	let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("No automatic network request expected"); });
	const html = renderToStaticMarkup(<PlaygroundAgentReview context={context} />);
	assert.equal(calls, 0); assert.match(html, /No models are enabled by default/);
	assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""/);
	assert.match(html, /nothing is read, changed or executed/);
	assert.match(html, /aria-label="Proposal mode" aria-haspopup="menu"/);
});
