import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentQuestionQueue, parseQuestionForm, questionTool, validateQuestionDecision, type QuestionChallenge, type QuestionDecision } from "../../src/lib/playgroundQuestions";
import { NativeAgentLoop, type AgentLoopServices, type AgentLoopEvent } from "../../src/lib/playgroundAgentLoop";
import { validateAgentRequest, validateAgentReply } from "../../nestjs-backend/src/desktop/playground-agent-contract";
import { executableCall } from "../../nestjs-backend/src/desktop/playground-agent-tickets.service";
import type { NativeAgentReply, NativeAgentRequest } from "../../src/lib/playgroundAgent";
import PlaygroundAgentQuestion from "../../src/components/playground/PlaygroundAgentQuestion";

const fixture = JSON.parse(readFileSync("tests/fixtures/playground-question.json", "utf8"));
const form = () => parseQuestionForm(JSON.stringify(fixture.form));
const challenge = (): QuestionChallenge => ({ version: 1, id: crypto.randomUUID(), callId: "q_1", form: form() });
const decision = (q: QuestionChallenge): QuestionDecision => ({ version: 1, id: q.id, cancelled: false, answers: fixture.answers });
let sequence = 0;
const reply = (tool_calls: NativeAgentReply["tool_calls"] = []): NativeAgentReply => ({ version: 1, runId: "dsk-" + (++sequence).toString(16).padStart(24, "0"), settlement: "succeeded", text: "Clarify first.",
	finish_reason: tool_calls.length ? "tool_calls" : "stop", tool_calls, usage: { prompt_tokens: 20, completion_tokens: 5 } });
const questionCall = () => ({ id: "q_1", name: "question", arguments: JSON.stringify(fixture.form) });

test("question forms are bounded, closed, Unicode-safe and reject nested duplicate keys", () => {
	assert.deepEqual(questionTool().parameters, fixture.schema);
	assert.deepEqual(form(), fixture.form);
	for (const raw of ['{"questions":[],"questions":[]}', JSON.stringify(fixture.form).replace('"header":"Database"', '"header":"Database","header":"Injected"'),
		JSON.stringify({ questions: [{ ...fixture.form.questions[0], options: [{ label: "same", description: "" }, { label: "same", description: "" }] }] }),
		JSON.stringify({ questions: [{ ...fixture.form.questions[0], extra: true }] }), JSON.stringify({ questions: Array(5).fill(fixture.form.questions[0]) }),
		JSON.stringify({ questions: [{ ...fixture.form.questions[0], header: "\ud800" }] })]) assert.throws(() => parseQuestionForm(raw));
});

test("questions cannot share a native batch with actions computed before the clarification", () => {
	const base = JSON.parse(readFileSync("tests/fixtures/playground-agent.json", "utf8")).request;
	const request = validateAgentRequest({ ...base, tools: [...base.tools, questionTool()] });
	assert.throws(() => validateAgentReply(reply([questionCall(), { id: "read_2", name: "read_file", arguments: '{"path":"main.py"}' }]), request));
});

test("answers match the exact fresh question and cannot smuggle approval fields", () => {
	const q = challenge(); assert.deepEqual(validateQuestionDecision(q, decision(q)).answers, fixture.answers);
	for (const invalid of [{ ...decision(q), id: crypto.randomUUID() }, { ...decision(q), approved: true },
		{ ...decision(q), answers: [{ selected: [0, 0], custom: "" }, fixture.answers[1]] }, { ...decision(q), answers: [{ selected: [0], custom: "also" }, fixture.answers[1]] },
		{ ...decision(q), answers: [{ selected: [8], custom: "" }, fixture.answers[1]] }, { ...decision(q), cancelled: true }]) assert.throws(() => validateQuestionDecision(q, invalid));
	assert.equal(validateQuestionDecision(q, { version: 1, id: q.id, cancelled: true, answers: [] }).cancelled, true);
});

test("question queue rejects stale/double answers, snapshots inputs and cancels on dismissal", async () => {
	const queue = new AgentQuestionQueue(); const q = challenge(); const controller = new AbortController();
	const result = queue.request(q, controller.signal); assert.equal(queue.getSnapshot()?.id, q.id);
	assert.equal(queue.answer({ ...decision(q), id: crypto.randomUUID() }), false);
	assert.equal(queue.answer(decision(q)), true); assert.equal(queue.answer(decision(q)), false);
	assert.equal((await result).cancelled, false); assert.equal(queue.getSnapshot(), null);
	await assert.rejects(queue.request(q, controller.signal));
	const next = challenge(); const cancelled = queue.request(next, controller.signal); controller.abort();
	assert.equal((await cancelled).cancelled, true); assert.equal(queue.answer(decision(next)), false);
});

test("question rendering offers custom answers and labels them as clarification, not approval", () => {
	const html = renderToStaticMarkup(<PlaygroundAgentQuestion challenge={challenge()} answer={() => { throw new Error("No event during render"); }} />);
	assert.match(html, /Your own answer: Database/); assert.match(html, /type="radio"/); assert.match(html, /type="checkbox"/);
	assert.match(html, /They do not approve/); assert.match(html, /Dismiss and stop/); assert.doesNotMatch(html, /Approve once/);
});

test("a native question pauses the loop and never enters sandbox approval or dispatch", async () => {
	const queue = new AgentQuestionQueue(); const calls: string[] = []; const requests: NativeAgentRequest[] = [];
	const services: AgentLoopServices = { workspace: { id: crypto.randomUUID(), location: "hosted-docker" }, supportsModel: () => true,
		turn: async request => { validateAgentRequest(request); requests.push(request); return requests.length === 1 ? reply([questionCall()]) : reply(); },
		ask: (q, signal) => queue.request(q, signal), approve: async q => { calls.push("approve"); return { approvalId: q.id, approved: true }; },
		invoke: async () => { calls.push("invoke"); throw new Error("Question must not execute"); }, abort: async () => { calls.push("abort"); return true; } };
	const events: AgentLoopEvent[] = [];
	const pending = (async () => { for await (const event of new NativeAgentLoop(services).run({ model: "lfm2_5_230m_q4_k_m", inputContextTokens: 16384 }, "build", "Ask first.")) events.push(event); })();
	await new Promise<void>(resolve => { const off = queue.subscribe(() => { if (queue.getSnapshot()) { off(); resolve(); } }); });
	const q = queue.getSnapshot()!; assert.deepEqual(calls, []); assert.equal(requests.length, 1); queue.answer(decision(q)); await pending;
	assert.deepEqual(calls, []); assert.equal(events.at(-1)?.kind, "finished");
	const result = JSON.parse(requests[1].history[0].tool_results[0].content); assert.equal(result.grantsExecutionPermission, false); assert.deepEqual(result.answers, fixture.answers);
	assert.throws(() => executableCall(questionCall(), "build"));
});

test("dismissed questions prevent follow-up inference without claiming sandbox execution", async () => {
	let invoked = 0;
	const services: AgentLoopServices = { workspace: { id: crypto.randomUUID(), location: "hosted-docker" }, supportsModel: () => true,
		turn: async () => reply([questionCall()]),
		ask: async q => ({ version: 1, id: q.id, cancelled: true, answers: [] }), invoke: async () => { invoked++; throw new Error(); }, abort: async () => true };
	const events: AgentLoopEvent[] = []; for await (const event of new NativeAgentLoop(services).run({ model: "lfm2_5_230m_q4_k_m", inputContextTokens: 16384 }, "build", "Ask.")) events.push(event);
	assert.equal(invoked, 0); assert.equal(events.at(-1)?.kind, "stopped"); assert.equal(events.some(event => event.kind === "approval.required"), false);
});

test("reserved interaction schema cannot be replaced, relabelled read-only or used by another tool", () => {
	const base = JSON.parse(readFileSync("tests/fixtures/playground-agent.json", "utf8")).request;
	validateAgentRequest({ ...base, tools: [questionTool()] });
	for (const tool of [{ ...questionTool(), name: "run_command" }, { ...questionTool(), effect: "read_only" },
		{ ...questionTool(), parameters: { type: "object", properties: {}, required: [], additionalProperties: false } }]) assert.throws(() => validateAgentRequest({ ...base, tools: [tool] }));
});

test("completed conversation preserves user/assistant roles and pairs, and reserves earlier call IDs", () => {
	const base = JSON.parse(readFileSync("tests/fixtures/playground-agent.json", "utf8")).request;
	const request = { ...base, tools: [questionTool()], conversation: [{ message: "Earlier request", text: "Earlier answer", history: [{ text: "Asking", tool_calls: [questionCall()], tool_results: [{ tool_call_id: "q_1", content: "A clarification, not consent" }] }] }] };
	validateAgentRequest(request); assert.throws(() => validateAgentReply(reply([questionCall()]), request));
	assert.throws(() => validateAgentRequest({ ...request, conversation: [{ ...request.conversation[0], approved: true }] }));
});
