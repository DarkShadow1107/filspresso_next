import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HostedAgentWorkspace, HostedAgentServices, type HostedAgentIo, type HostedAgentSnapshot } from "../../src/lib/playgroundHostedAgent";
import { AgentConsentQueue } from "../../src/lib/playgroundAgentConsent";
import { parseNativeAgentReply, type NativeAgentReply, type NativeCall } from "../../src/lib/playgroundAgent";
import { buildProposalReview } from "../../src/lib/playgroundAgentReview";
import PlaygroundAgentWorkspace from "../../src/components/playground/PlaygroundAgentWorkspace";

const context = { model: "lfm2_5_230m_q4_k_m", inputContextTokens: 16_384 };
const sandboxId = "00000000-0000-4000-8000-000000000042";
const sandbox = { id: sandboxId, location: "hosted-docker", network: "disabled", workspace: "/workspace", ephemeral: true, policyVersion: 2 };
const write: NativeCall = { id: "write_1", name: "write_file", arguments: '{"path":"main.py","text":"print(1)"}' };
const command: NativeCall = { id: "run_1", name: "run_command", arguments: '{"command":"python3 main.py"}' };
let sequence = 0;
const response = (calls: NativeCall[] = []): NativeAgentReply => ({ version: 1, runId: "dsk-" + (++sequence).toString(16).padStart(24, "0"), settlement: "succeeded", text: calls.length ? "Proposed." : "Finished.", finish_reason: calls.length ? "tool_calls" : "stop", tool_calls: calls,
	usage: { prompt_tokens: 100, completion_tokens: 10 }, action_tickets: calls.map(call => ({ tool_call_id: call.id, token: "e30." + "a".repeat(43), expires_at: Math.floor(Date.now() / 1000) + 300 })) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
	const posts: Array<{ path: string; method: string; body: unknown }> = []; const replies: NativeAgentReply[] = [];
	const challenges = new Map<string, { actionId: string; runId: string; sandboxId: string; toolCallId: string; requiresApproval: boolean; expiresAt: number }>();
	const io: HostedAgentIo = { models: async () => [context.model], turn: async () => { assert.ok(replies.length); return replies.shift()!; },
		json: async (path, method, raw) => {
			posts.push({ path, method, body: raw });
			if (path.endsWith("/capabilities")) return { version: 1, enabled: true, protocol: "actions-v1", location: "hosted-docker" };
			if (path === "/api/playground/sandbox") return { ...sandbox };
			if (method === "DELETE") return { stopped: true };
			const body = raw as { call: NativeCall; approved: boolean };
			if (path === "/api/playground/agent/actions") {
				const challenge = { actionId: crypto.randomUUID(), runId: "exec-" + (++sequence).toString(16).padStart(24, "0"), sandboxId, toolCallId: body.call.id, requiresApproval: body.call.name !== "read_file", expiresAt: Math.floor(Date.now() / 1000) + 300 };
				challenges.set(body.call.id, challenge); return { version: 1, ...challenge };
			}
			const challenge = challenges.get(body.call.id)!; assert.ok(challenge);
			if (!body.approved) return { version: 1, actionId: challenge.actionId, status: "declined", executed: false };
			return { version: 1, ...challenge, status: "complete", executed: true, result: { stdout: "tool output", stderr: "", exitCode: 0, timedOut: false, truncated: false, durationMs: 20 } };
		} };
	return { io, posts, replies, challenges, workspace: new HostedAgentWorkspace(io) };
}
function waitFor(workspace: HostedAgentWorkspace, predicate: (state: HostedAgentSnapshot) => boolean): Promise<HostedAgentSnapshot> {
	if (predicate(workspace.getSnapshot())) return Promise.resolve(workspace.getSnapshot());
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => { unsubscribe(); reject(new Error("Expected workspace state was not reached")); }, 3000);
		const unsubscribe = workspace.subscribe(() => { if (predicate(workspace.getSnapshot())) { clearTimeout(timer); unsubscribe(); resolve(workspace.getSnapshot()); } });
	});
}

test("opening the hosted agent performs no requests and cannot execute before explicit capability/start", async () => {
	const state = setup(); await state.workspace.run(context, "build", "Do work."); await state.workspace.startSandbox();
	assert.equal(state.posts.length, 0); assert.equal(state.workspace.getSnapshot().workspace, null);
	await state.workspace.check(); assert.equal(state.posts.length, 1); assert.equal(state.workspace.getSnapshot().executionEnabled, true);
	await state.workspace.startSandbox(); assert.equal(state.workspace.getSnapshot().workspace?.id, sandboxId); await state.workspace.stop();
});

test("disabled executor capabilities never create or execute a sandbox", async () => {
	const state = setup(); state.io.json = async () => ({ version: 1, enabled: false, protocol: "actions-v1", location: "hosted-docker" });
	await state.workspace.check(); await state.workspace.startSandbox(); assert.equal(state.workspace.getSnapshot().workspace, null);
});

test("Build waits for fresh exact consent, reports denial, then executes only the separately approved action", async () => {
	const state = setup(); state.replies.push(response([write, command]), response()); await state.workspace.check(); await state.workspace.startSandbox();
	const running = state.workspace.run(context, "build", "Create and test.");
	let pending = (await waitFor(state.workspace, value => value.pendingApproval !== null)).pendingApproval!;
	assert.equal(pending.call.id, write.id); assert.equal(state.posts.some(post => post.path.endsWith("/execute")), false);
	state.workspace.decide(pending.id, false);
	pending = (await waitFor(state.workspace, value => value.pendingApproval?.call.id === command.id)).pendingApproval!;
	assert.equal(state.workspace.decide(crypto.randomUUID(), true), false); state.workspace.decide(pending.id, true); await running;
	assert.equal(state.workspace.getSnapshot().phase, "complete");
	const executes = state.posts.filter(post => post.path.endsWith("/execute")); assert.equal(executes.length, 2);
	assert.deepEqual(executes.map(post => (post.body as { approved: boolean }).approved), [false, true]);
	assert.ok(state.workspace.getSnapshot().events.some(event => event.kind === "tool.finished" && event.invocation.refused)); await state.workspace.stop();
});

test("Plan reads use a signed one-shot server action without a mutation consent prompt", async () => {
	const state = setup(); state.replies.push(response([{ id: "read_1", name: "read_file", arguments: '{"path":"main.py"}' }]), response());
	await state.workspace.check(); await state.workspace.startSandbox(); await state.workspace.run(context, "plan", "Read.");
	assert.equal(state.workspace.getSnapshot().phase, "complete"); assert.equal(state.workspace.getSnapshot().pendingApproval, null);
	assert.equal(state.posts.filter(post => post.path.endsWith("/execute")).length, 1); await state.workspace.stop();
});

test("stopping at approval invalidates pending consent, clears account-scoped state and discards once", async () => {
	const state = setup(); state.replies.push(response([command])); await state.workspace.check(); await state.workspace.startSandbox();
	const running = state.workspace.run(context, "build", "Run."); const pending = (await waitFor(state.workspace, value => !!value.pendingApproval)).pendingApproval!;
	await Promise.all([state.workspace.stop(true), state.workspace.stop(true)]); await running;
	assert.equal(state.workspace.decide(pending.id, true), false); assert.equal(state.workspace.getSnapshot().pendingApproval, null);
	assert.deepEqual(state.workspace.getSnapshot().models, []); assert.equal(state.posts.filter(post => post.method === "DELETE").length, 1);
	assert.equal(state.posts.some(post => post.path.endsWith("/execute")), false);
});

test("lost action replies stop without POST retry and quarantine/discard instead of continuing inference", async () => {
	const state = setup(); const json = state.io.json; state.io.json = async (...args) => { if (args[0].endsWith("/execute")) { state.posts.push({ path: args[0], method: args[1], body: args[2] }); throw new Error("Lost reply"); } return json(...args); };
	state.replies.push(response([command]), response()); await state.workspace.check(); await state.workspace.startSandbox();
	const running = state.workspace.run(context, "build", "Run."); const pending = (await waitFor(state.workspace, value => !!value.pendingApproval)).pendingApproval!;
	state.workspace.decide(pending.id, true); await running;
	assert.equal(state.posts.filter(post => post.path.endsWith("/execute")).length, 1); assert.equal(state.replies.length, 1);
	assert.equal(state.workspace.getSnapshot().workspace, null); assert.equal(state.workspace.getSnapshot().phase, "failed");
});

test("unconfirmed discard remains non-reusable and exposes retry rather than fabricating teardown", async () => {
	const state = setup(); await state.workspace.check(); await state.workspace.startSandbox(); const json = state.io.json;
	state.io.json = async (...args) => { if (args[1] === "DELETE") throw new Error(); return json(...args); };
	await state.workspace.stop(); assert.equal(state.workspace.getSnapshot().quarantined?.id, sandboxId); await state.workspace.startSandbox();
	assert.equal(state.posts.filter(post => post.path === "/api/playground/sandbox").length, 1);
	state.io.json = json; await state.workspace.stop(); assert.equal(state.workspace.getSnapshot().quarantined, null);
});

test("late availability and sandbox creation replies cannot repopulate a cleared account/view", async () => {
	const state = setup(); const models = deferred<string[]>(); state.io.models = () => models.promise;
	const checking = state.workspace.check(); await state.workspace.stop(true); models.resolve([context.model]); await checking;
	assert.deepEqual(state.workspace.getSnapshot().models, []);
	state.io.models = async () => [context.model]; await state.workspace.check(); const json = state.io.json; const creation = deferred<Record<string, unknown>>();
	state.io.json = (...args) => args[0] === "/api/playground/sandbox" ? creation.promise : json(...args);
	const starting = state.workspace.startSandbox(); await state.workspace.stop(true); creation.resolve({ ...sandbox }); await starting;
	assert.equal(state.workspace.getSnapshot().workspace, null); assert.equal(state.posts.filter(post => post.method === "DELETE").length, 1);
});

test("an adapter cannot invoke a write directly without consent or reuse it after a lost/consumed decision", async () => {
	const state = setup(); state.replies.push(response([write])); const consent = new AgentConsentQueue();
	const adapter = new HostedAgentServices({ id: sandboxId, location: "hosted-docker" }, [context.model], consent, state.io);
	await adapter.turn(buildProposalReview(context, "build", "Propose."), new AbortController().signal);
	await assert.rejects(adapter.invoke(adapter.workspace, write, new AbortController().signal), /approval/);
	assert.equal(state.posts.some(post => post.path.endsWith("/execute")), false);
});

test("action-ticket transport rejects duplicated, unknown-call and malformed evidence", () => {
	const request = buildProposalReview(context, "build", "Propose."); const good = response([write]); assert.equal(parseNativeAgentReply(good, request).action_tickets?.length, 1);
	for (const tickets of [[good.action_tickets![0], good.action_tickets![0]], [{ ...good.action_tickets![0], tool_call_id: "unknown" }], [{ ...good.action_tickets![0], token: "not-signed" }]])
		assert.throws(() => parseNativeAgentReply({ ...good, action_tickets: tickets }, request));
});

test("rendering exposes explicit controls but no startup request, automatic execution or markup evaluation", t => {
	let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error(); });
	const html = renderToStaticMarkup(<PlaygroundAgentWorkspace context={context} />);
	assert.equal(calls, 0); assert.match(html, /Check availability to see whether/); assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""/);
	assert.doesNotMatch(html, /<script|onclick=/i); assert.match(html, /fresh approval per write\/command/);
});

test("idle cleanup never invents a stopped job or billing warning", async () => {
	const state = setup();
	await state.workspace.stop(true);
	await state.workspace.stop(true);
	assert.equal(state.workspace.getSnapshot().error, "");
	assert.equal(state.workspace.getSnapshot().phase, "idle");
	assert.deepEqual(state.posts, []);
});

test("shared thread continues in Plan with only read tools and no inherited Build approval", async () => {
	const state = setup(); const requests: unknown[] = [];
	state.io.turn = async request => { requests.push(request); return response(); };
	await state.workspace.check(); await state.workspace.startSandbox();
	await state.workspace.run(context, "build", "Earlier Build request");
	assert.equal(state.workspace.continueFromTranscript([{ message: "Earlier Build request", text: "Completed earlier, not approval for the next action", history: [] }]), true);
	await state.workspace.run(context, "plan", "Now inspect only");
	const plan = requests[1] as { mode: string; conversation: unknown[]; tools: { name: string }[] };
	assert.equal(plan.mode, "plan"); assert.equal(plan.conversation.length, 1);
	assert.deepEqual(plan.tools.map(tool => tool.name), ["read_file", "question"]);
	assert.equal(state.workspace.getSnapshot().workspace?.id, sandboxId);
	assert.equal(state.posts.some(post => post.path.endsWith("/execute")), false);
	await state.workspace.stop();
});

test("transcript bridge cannot replace a pending action, restore tool history or escape a failed run", async () => {
	const state = setup(); state.replies.push(response([command]));
	await state.workspace.check(); await state.workspace.startSandbox();
	const running = state.workspace.run(context, "build", "Request command");
	const pending = (await waitFor(state.workspace, value => !!value.pendingApproval)).pendingApproval!;
	assert.equal(state.workspace.continueFromTranscript([]), false);
	assert.equal(state.workspace.getSnapshot().pendingApproval?.id, pending.id);
	await state.workspace.stop(); await running;
	assert.equal(state.workspace.decide(pending.id, true), false);
	assert.equal(state.workspace.continueFromTranscript([{ message: "old", text: "answer", history: [{ text: "", tool_calls: [command], tool_results: [{ tool_call_id: command.id, content: "approved" }] }] }]), false);
});

test("late uncooperative preparation cannot dispatch after cancellation or invalidation", async () => {
	for (const invalidated of [false, true]) {
		const state = setup(); state.replies.push(response([{ id: "read_1", name: "read_file", arguments: '{"path":"main.py"}' }]));
		const consent = new AgentConsentQueue(); const adapter = new HostedAgentServices({ id: sandboxId, location: "hosted-docker" }, [context.model], consent, state.io);
		const controller = new AbortController(); const read = (await adapter.turn(buildProposalReview(context, "plan", "Read."), controller.signal)).tool_calls[0];
		const json = state.io.json; const entered = deferred<void>(); const finish = deferred<void>();
		state.io.json = async (...args) => { if (args[0] === "/api/playground/agent/actions") { entered.resolve(); await finish.promise; } return json(...args); };
		const invoking = adapter.invoke(adapter.workspace, read, controller.signal); await entered.promise;
		if (invalidated) await adapter.abort(adapter.workspace, new AbortController().signal); else controller.abort();
		finish.resolve(); await assert.rejects(invoking);
		assert.equal(state.posts.some(post => post.path.endsWith("/execute")), false);
	}
});

test("an unconfirmed late-created sandbox remains quarantined instead of being forgotten", async () => {
	const state = setup(); await state.workspace.check(); const json = state.io.json;
	const creation = deferred<Record<string, unknown>>();
	state.io.json = async (...args) => { if (args[0] === "/api/playground/sandbox") return creation.promise; if (args[1] === "DELETE") throw new Error("Cleanup unavailable"); return json(...args); };
	const starting = state.workspace.startSandbox(); await state.workspace.stop(true);
	assert.equal(state.workspace.getSnapshot().creationPending, true); assert.equal(state.workspace.getSnapshot().phase, "stopping");
	await state.workspace.check(); await state.workspace.startSandbox();
	assert.equal(state.workspace.getSnapshot().creationPending, true);
	creation.resolve({ ...sandbox }); await starting;
	assert.equal(state.workspace.getSnapshot().quarantined?.id, sandboxId); assert.equal(state.workspace.getSnapshot().phase, "failed");
	state.io.json = json; await state.workspace.stop(); assert.equal(state.workspace.getSnapshot().quarantined, null);
});

test("shared paired-compaction receipts retain inspectable memory and reject invalid cuts/counts", () => {
	const compacted = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/playground-agent-compaction.json"), "utf8"));
	const request = { ...buildProposalReview(context, "plan", "Read."), history: compacted.history };
	const body = { ...response(), usage: compacted.usage, compaction: compacted.compaction };
	assert.equal(parseNativeAgentReply(body, request).compaction?.summary, compacted.compaction.summary);
	for (const changes of [{ consumedGroups: 2 }, { tokensAfter: 12000 }, { mode: "aggressive" }, { usage: { prompt_tokens: 700, completion_tokens: 20 } }])
		assert.throws(() => parseNativeAgentReply({ ...body, compaction: { ...compacted.compaction, ...changes } }, request));
});

test("a hosted question needs no executable ticket and answering cannot approve the next command", async () => {
	const state = setup(); const fixture = JSON.parse(readFileSync("tests/fixtures/playground-question.json", "utf8"));
	const question = { id: "q_1", name: "question", arguments: JSON.stringify(fixture.form) };
	const first = response([question]); first.action_tickets = [];
	state.replies.push(first, response([command]), response()); await state.workspace.check(); await state.workspace.startSandbox();
	const running = state.workspace.run(context, "build", "Ask before acting.");
	const q = (await waitFor(state.workspace, value => !!value.pendingQuestion)).pendingQuestion!;
	assert.equal(state.workspace.decide(q.id, true), false); assert.equal(state.posts.some(post => post.path === "/api/playground/agent/actions"), false);
	assert.equal(state.workspace.answer({ version: 1, id: q.id, cancelled: false, answers: fixture.answers }), true);
	const approval = (await waitFor(state.workspace, value => !!value.pendingApproval)).pendingApproval!;
	assert.notEqual(approval.id, q.id); assert.equal(state.posts.some(post => post.path.endsWith("/execute")), false);
	state.workspace.decide(approval.id, true); await running;
	assert.equal(state.posts.filter(post => post.path.endsWith("/execute")).length, 1); await state.workspace.stop();
});

test("hosted follow-ups retain complete conversation turns and a queued message is not a POST retry", async () => {
	const state = setup(); const pending = deferred<NativeAgentReply>(); const requests: Parameters<HostedAgentIo["turn"]>[0][] = [];
	state.io.turn = async request => { requests.push(request); return requests.length === 1 ? pending.promise : response(); };
	await state.workspace.check(); await state.workspace.startSandbox(); const running = state.workspace.run(context, "build", "Initial request");
	assert.equal(state.workspace.queueFollowUp(context, "build", "Follow-up request"), true);
	assert.equal(state.workspace.queueFollowUp(context, "build", "Overwrite?"), false); assert.equal(requests.length, 1);
	pending.resolve(response()); await running;
	assert.equal(requests.length, 2); assert.equal(requests[1].conversation?.[0].message, "Initial request");
	assert.equal(requests[1].message, "Follow-up request"); assert.equal(state.workspace.getSnapshot().conversationTurns, 2);
	assert.equal(state.workspace.getSnapshot().events.filter(event => event.kind === "user.message").length, 2); await state.workspace.stop();
});

test("question dismissal clears queued requests and requires a fresh sandbox instead of silently losing partial history", async () => {
	const state = setup(); const form = JSON.parse(readFileSync("tests/fixtures/playground-question.json", "utf8")).form;
	const first = response([{ id: "q_1", name: "question", arguments: JSON.stringify(form) }]); first.action_tickets = [];
	state.replies.push(first); await state.workspace.check(); await state.workspace.startSandbox(); const running = state.workspace.run(context, "build", "Initial");
	const question = (await waitFor(state.workspace, value => !!value.pendingQuestion)).pendingQuestion!;
	state.workspace.queueFollowUp(context, "build", "Never send"); state.workspace.answer({ version: 1, id: question.id, cancelled: true, answers: [] }); await running;
	assert.equal(state.workspace.getSnapshot().requiresReset, true); assert.equal(state.workspace.getSnapshot().queuedPrompt, null);
	await state.workspace.run(context, "build", "Must not send"); assert.equal(state.replies.length, 0); await state.workspace.stop();
});

test("integrated explorer observes the agent's same sandbox, excludes invalid paths and clears late reads on stop", async () => {
	const state = setup(); const json = state.io.json;
	state.io.json = async (...args) => {
		if (args[0].endsWith("/files")) return { files: ["main.py", "results.txt"] };
		if (args[0].includes("/file?")) { const path = new URL(args[0], "http://fixture").searchParams.get("path"); return { path, text: path === "main.py" ? "print(1)\n" : "command-produced output" }; }
		return json(...args);
	};
	await state.workspace.check(); await state.workspace.startSandbox();
	const files = await state.workspace.captureProject(); assert.equal(files[1].text, "command-produced output");
	const delayed = deferred<Record<string, unknown>>();
	state.io.json = async (...args) => args[0].endsWith("/files") ? delayed.promise : json(...args);
	const inspecting = state.workspace.captureProject(); await state.workspace.stop(true);
	delayed.resolve({ files: ["../outside.txt"] }); await assert.rejects(inspecting);
	assert.equal(state.workspace.getSnapshot().workspace, null); assert.deepEqual(state.workspace.getSnapshot().models, []);
});

test("new conversation changes mode without deleting project files or reusing prior context/approvals", async () => {
	const state = setup(); const requests: Parameters<HostedAgentIo["turn"]>[0][] = [];
	state.io.turn = async request => { requests.push(request); return response(); };
	await state.workspace.check(); await state.workspace.startSandbox();
	await state.workspace.run(context, "build", "First"); assert.equal(state.workspace.newConversation(), true);
	await state.workspace.run(context, "plan", "Different direction");
	assert.equal(requests[1].mode, "plan"); assert.deepEqual(requests[1].conversation ?? [], []);
	assert.equal(state.workspace.getSnapshot().workspace?.id, sandboxId);
	assert.equal(state.posts.some(post => post.method === "DELETE"), false); await state.workspace.stop();
});

test("local imports require a distinct explicit per-file approval and never retry lost uploads", async () => {
	const state = setup(); await state.workspace.check(); await state.workspace.startSandbox();
	await assert.rejects(state.workspace.uploadReviewedFile({ path: "a.txt", text: "x" }, false));
	const json = state.io.json;
	state.io.json = async (...args) => {
		if (args[1] === "PUT") { state.posts.push({ path: args[0], method: args[1], body: args[2] }); throw new Error("Lost write receipt"); }
		return json(...args);
	};
	await assert.rejects(state.workspace.uploadReviewedFile({ path: "a.txt", text: "x" }, true));
	assert.equal(state.posts.filter(post => post.method === "PUT").length, 1);
	assert.equal(state.workspace.getSnapshot().requiresReset, true);
	await assert.rejects(state.workspace.uploadReviewedFile({ path: "a.txt", text: "x" }, true));
	assert.equal(state.posts.filter(post => post.method === "PUT").length, 1); await state.workspace.stop();
});
