/** Real Docker + PostgreSQL, deliberately FIXTURE model/billing. No live inference or money.
 * Invoked only by playground-sandbox/Smoke-Agent.ps1 against its temporary loopback services. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import type { DatabaseService } from "../../src/database/database.service";
import type { BillingService } from "../../src/billing/billing.service";
import type { AddonsService } from "../../src/billing/addons.service";
import { AGENT_ACTIONS_SCHEMA } from "../../src/desktop/playground-agent-actions.schema";
import { PlaygroundAgentTicketsService } from "../../src/desktop/playground-agent-tickets.service";
import { PlaygroundAgentActionsService } from "../../src/desktop/playground-agent-actions.service";
import { PlaygroundRunEventsService } from "../../src/desktop/playground-run-events.service";
import { PlaygroundSandboxService } from "../../src/desktop/playground-sandbox.service";
import { DesktopGatewayService } from "../../src/desktop/desktop-gateway.service";
import { NativeAgentLoop, type AgentLoopEvent } from "../../../src/lib/playgroundAgentLoop";
import { HostedAgentServices, type HostedAgentIo } from "../../../src/lib/playgroundHostedAgent";
import { AgentConsentQueue } from "../../../src/lib/playgroundAgentConsent";
import { AgentQuestionQueue } from "../../../src/lib/playgroundQuestions";
import { AGENT_SYSTEM_PROMPT } from "../../../src/lib/playgroundAgentLoop";
import { buildProposalReview } from "../../../src/lib/playgroundAgentReview";
import type { NativeAgentRequest, NativeCall } from "../../../src/lib/playgroundAgent";

async function main() {
	const database = new URL(process.env.PLAYGROUND_AGENT_TEST_DATABASE_URL || "");
	const broker = new URL(process.env.PLAYGROUND_SANDBOX_TEST_URL || "");
	assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.pathname, "/agent_smoke");
	assert.equal(broker.hostname, "127.0.0.1"); assert.equal(broker.protocol, "http:");
	assert.ok((process.env.PLAYGROUND_SANDBOX_NAMESPACE || "").startsWith("filspresso-agent-check-"));
	process.env.PLAYGROUND_SANDBOX_URL = broker.origin;
	process.env.PLAYGROUND_AGENT_EXECUTION_ENABLED = "true";
	process.env.PLAYGROUND_AGENT_MODEL_FILES = "LFM2.5-230M-Q4_K_M.gguf";
	const liveModel = process.env.PLAYGROUND_AGENT_LIVE_MODEL === "true";
	if (!liveModel) process.env.AI_SERVICE_KEY = "fixture-only-no-live-model";
	if (liveModel && !process.env.AI_SERVICE_KEY?.trim()) throw new Error("Live model qualification requires the configured AI service key.");
	process.env.PYTHON_AI_HOST = liveModel ? "http://live-ai:5000" : "http://fixture-ai";
	const pool = new Pool({ connectionString: database.toString(), max: 8, connectionTimeoutMillis: 3000, statement_timeout: 5000, query_timeout: 10_000 });
	const db = { getPool: () => pool } as unknown as DatabaseService;
	const charges: unknown[] = []; const requests: NativeAgentRequest[] = [];
	const billing = { resolveTierFor: async () => "pro", getBalance: async () => ({ canGenerate: true }), getAllowance: async () => ({ remainingRon: 0 }), recordUsage: async (value: unknown) => { charges.push(value); } } as unknown as BillingService;
	const addons = { resolveSpectreAccess: async () => ({ hasAccess: true, source: "addon" }) } as unknown as AddonsService;
	const events = new PlaygroundRunEventsService(db); const sandboxes = new PlaygroundSandboxService(billing, addons, events);
	const tickets = new PlaygroundAgentTicketsService(); const actions = new PlaygroundAgentActionsService(db, tickets, sandboxes, events);
	const gateway = new DesktopGatewayService(billing, addons, events, tickets);
	const read = (id: string): NativeCall => ({ id, name: "read_file", arguments: '{"path":"main.py"}' });
	const write: NativeCall = { id: "write_1", name: "write_file", arguments: JSON.stringify({ path: "main.py", text: "print('signed-agent-smoke')\n" }) };
	const command: NativeCall = { id: "run_1", name: "run_command", arguments: '{"command":"python3 main.py"}' };
	const questionFixture = JSON.parse(readFileSync(join(__dirname, "../../../tests/fixtures/playground-question.json"), "utf8"));
	const question: NativeCall = { id: "question_1", name: "question", arguments: JSON.stringify(questionFixture.form) };
	const replies = [[question], [read("read_missing")], [write], [read("read_written")], [], [], [{ ...write, id: "write_race" }]];
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const target = String(input);
		if (liveModel && target.endsWith("/api/playground/agent/turn")) console.error("Live model relay target:", new URL(target).host);
		if (target.startsWith("http://fixture-ai/") || (liveModel && target.endsWith("/api/playground/agent/turn"))) {
			let request = JSON.parse(String(init?.body)) as NativeAgentRequest;
			if (liveModel) {
				// Keep this operator qualification narrow: the same production turn validator,
				// authentication, ticket issuance and broker dispatch run, but the model has
				// only the exact harmless tool under test to choose from.
				const required = request.message.toLowerCase().includes("read_file") ? "read_file" : "write_file";
				request = { ...request, tools: request.tools.filter(tool => tool.name === required) };
			}
			requests.push(request);
			if (liveModel) {
				// The harness runs on Windows; execute only an HTTP relay inside the already
				// running AI container so the production AI network/model path is exercised.
				const relay = `import json,sys,urllib.request,urllib.error\nd=json.load(sys.stdin)\nr=urllib.request.Request('http://ai:5000/api/playground/agent/turn',data=json.dumps(d['body']).encode(),headers={'Content-Type':'application/json','x-ai-service-key':d['key']},method='POST')\ntry:\n x=urllib.request.urlopen(r,timeout=125); status=x.status; body=x.read(1048576).decode()\nexcept urllib.error.HTTPError as e:\n status=e.code; body=e.read(1048576).decode()\nprint(json.dumps({'status':status,'body':body}))`;
				try {
					const output = execFileSync("docker", ["exec", "-i", "filspresso_ai", "python", "-c", relay], {
						input: JSON.stringify({ body: request, key: process.env.AI_SERVICE_KEY }), encoding: "utf8", timeout: 140_000, maxBuffer: 2_000_000,
					});
					const response = JSON.parse(output) as { status: number; body: string };
					let details: Record<string, unknown> = {};
					try {
						const parsed = JSON.parse(response.body) as Record<string, unknown>;
						details = { keys: Object.keys(parsed), error: parsed.error, message: typeof parsed.message === "string" ? parsed.message.slice(0, 240) : undefined, finish_reason: parsed.finish_reason,
							toolNames: Array.isArray(parsed.tool_calls) ? parsed.tool_calls.map((call: { name?: string }) => call?.name).slice(0, 8) : [],
							text: typeof parsed.text === "string" ? parsed.text.slice(0, 240) : undefined };
					} catch { details = { bodyLength: response.body?.length ?? -1, invalidJson: true }; }
					console.error("Live AI HTTP reply:", JSON.stringify({ status: response.status, ...details }));
					return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
				} catch (error) {
					const detail = error as { code?: unknown; status?: unknown; stderr?: unknown };
					console.error("Live AI relay process failed:", JSON.stringify({ code: detail.code, status: detail.status, stderr: String(detail.stderr ?? "").slice(0, 500) }));
					throw new Error("Live AI relay failed; response details were withheld.");
				}
			}
			const calls = replies.shift(); assert.ok(calls);
			return Response.json({ version: 1, text: calls.length ? "Fixture native proposals." : "Fixture run complete.", finish_reason: calls.length ? "tool_calls" : "stop", tool_calls: calls, usage: { prompt_tokens: 100, completion_tokens: 16 } });
		}
		assert.ok(String(input).startsWith(broker.origin), "Smoke must not contact application services");
		return fetch(input, init);
	};
	let workspaceId: string | null = null;
	try {
		await pool.query("CREATE TABLE accounts (id BIGINT PRIMARY KEY); INSERT INTO accounts(id) VALUES (42),(43)");
		await pool.query(readFileSync(join(__dirname, "../../data/migrations/2026-10-playground-run-events.sql"), "utf8"));
		await pool.query(AGENT_ACTIONS_SCHEMA);
		assert.equal((await actions.capabilities(42)).enabled, true);
		const created = await sandboxes.request(42, "POST", "/sandboxes"); assert.equal(typeof created.id, "string"); workspaceId = created.id as string;
		const io: HostedAgentIo = {
			models: async () => gateway.agentModels(),
			turn: async (request, signal) => {
				const reply = await gateway.agentTurn(42, "pro", request, "playground", signal);
				if (reply.kind !== "completed") {
					if (liveModel) console.error("Live agent turn refused:", JSON.stringify({ status: reply.status, error: reply.error, message: reply.message }));
					throw new Error(reply.error);
				}
				return reply.payload;
			},
			json: async (path, method, body, signal) => {
				if (path === "/api/playground/agent/actions") return actions.prepare(42, body, signal);
				const match = /^\/api\/playground\/agent\/actions\/([^/]+)\/execute$/.exec(path);
				if (match) return actions.execute(42, match[1], body, signal);
				if (method === "DELETE" && path === `/api/playground/sandbox/${workspaceId}`) return sandboxes.request(42, "DELETE", `/sandboxes/${workspaceId}`, undefined, signal);
				throw new Error("Unexpected smoke transport request");
			},
		};
	const consent = new AgentConsentQueue(); let approvals = 0;
	consent.subscribe(() => { const pending = consent.getSnapshot(); if (!pending) return;
		if (liveModel) {
			assert.equal(pending.call.name, "write_file", "Live web qualification only permits the expected file write.");
			assert.deepEqual(JSON.parse(pending.call.arguments), { path: "live-agent-check.txt", text: "agent-live-ok" });
		} else assert.equal(pending.call.arguments, write.arguments, "Only the trusted literal fixture write is allowed");
			approvals++; consent.decide(pending.id, true);
		});
		const questions = new AgentQuestionQueue(); let questionCount = 0;
		questions.subscribe(() => { const pending = questions.getSnapshot(); if (!pending) return; questionCount++;
			assert.equal(consent.decide(pending.id, true), false);
			questions.answer({ version: 1, id: pending.id, cancelled: false, answers: questionFixture.answers });
		});
		const services = new HostedAgentServices({ id: workspaceId, location: "hosted-docker" }, gateway.agentModels(), consent, io, undefined, questions);
		const output: AgentLoopEvent[] = [];
		const prompt = liveModel
			? "Call the only available tool write_file exactly once with path live-agent-check.txt and text agent-live-ok. Do not answer in prose, use any other path, or run commands."
			: "Fixture read, write and read.";
		for await (const event of new NativeAgentLoop(services).run({ model: "lfm2_5_230m_q4_k_m", inputContextTokens: 16_384 }, "build", prompt)) output.push(event);
		if (liveModel) {
			assert.equal(output.at(-1)?.kind, "finished", JSON.stringify(output.filter(event => event.kind === "stopped")));
			assert.ok(requests.every(request => request.tools.every(tool => tool.name !== "run_command")), "Web model requests must never expose command execution.");
			const writeEvents = output.filter((event): event is Extract<AgentLoopEvent, { kind: "tool.finished" }> => event.kind === "tool.finished");
			assert.ok(writeEvents.some(event => event.invocation.call.name === "write_file" && event.invocation.result.exitCode === 0), "Expected approved write_file dispatch through Docker.");
			const firstFinished = output.at(-1);
			if (firstFinished?.kind !== "finished") throw new Error("Live file creation did not finish.");
			const readEvents: AgentLoopEvent[] = [];
			// Use a fresh model turn in the same sandbox. Keeping this qualification separate
			// avoids relying on small-model call-ID reuse behavior; conversation continuity is
			// covered independently by deterministic integration tests.
			for await (const event of new NativeAgentLoop(services).run({ model: "lfm2_5_230m_q4_k_m", inputContextTokens: 16_384 }, "build", "A previous approved action saved the file. Call the only available tool read_file with path live-agent-check.txt, then report its exact contents. Do not modify it or run commands.")) readEvents.push(event);
			assert.equal(readEvents.at(-1)?.kind, "finished", JSON.stringify(readEvents.filter(event => event.kind === "stopped")));
			assert.ok(requests.length >= 3, "Live model should complete write, read and final-answer turns.");
			assert.ok(requests.every(request => request.tools.every(tool => tool.name !== "run_command")), "Web model requests must never expose command execution.");
			const readCalls = readEvents.filter((event): event is Extract<AgentLoopEvent, { kind: "tool.finished" }> => event.kind === "tool.finished");
			assert.ok(readCalls.some(event => event.invocation.call.name === "read_file" && event.invocation.result.stdout.includes("agent-live-ok")), "Expected read_file to observe the written content.");
			assert.equal(approvals, 1, "Only the write should require explicit approval.");
			const finalText = readEvents.filter((event): event is Extract<AgentLoopEvent, { kind: "message" }> => event.kind === "message").map(event => event.text).join("\n");
			assert.match(finalText, /agent-live-ok/i);
			console.log("PASS: live llama.cpp model, real AI service authentication, disposable Docker sandbox, fresh write approval, brokered file write/read and final model response. Billing is mocked; no customer account was charged.");
			return;
		}
		assert.equal(output.at(-1)?.kind, "finished"); assert.equal(charges.length, 5); assert.equal(approvals, 1); assert.equal(questionCount, 1);
		const calls = output.filter((event): event is Extract<AgentLoopEvent, { kind: "tool.finished" }> => event.kind === "tool.finished");
		assert.equal(calls.length, 3); assert.equal(calls[0].invocation.result.exitCode, 1);
		assert.equal(calls[2].invocation.result.stdout, "print('signed-agent-smoke')\n");
		assert.equal(requests[4].history.length, 4); assert.equal(requests[4].system_prompt, AGENT_SYSTEM_PROMPT);
		assert.equal(requests[4].tools.some(tool => tool.name === command.name), false);
		for (const group of requests[4].history) assert.equal(group.tool_calls[0].id, group.tool_results[0].tool_call_id);
		assert.equal(JSON.parse(requests[4].history[0].tool_results[0].content).grantsExecutionPermission, false);
		const finished = output.at(-1); assert.equal(finished?.kind, "finished");
		if (finished?.kind !== "finished") throw new Error("Missing completed conversation");
		for await (const event of new NativeAgentLoop(services).run({ model: "lfm2_5_230m_q4_k_m", inputContextTokens: 16_384 }, "build", "Fixture conversation follow-up.", new AbortController().signal, [finished.conversationTurn])) output.push(event);
		assert.equal(charges.length, 6); assert.equal(requests[5].conversation?.length, 1); assert.equal(approvals, 1);
		// Exercise the database CAS with genuinely concurrent dispatch attempts, not a mocked pool.
		const request = buildProposalReview({ model: "lfm2_5_230m_q4_k_m", inputContextTokens: 16_384 }, "build", "Fixture concurrent approval test.");
		const racedReply = await io.turn(request, new AbortController().signal); const racedCall = racedReply.tool_calls[0];
		const challenge = await actions.prepare(42, { ticket: racedReply.action_tickets![0].token, sandboxId: workspaceId, call: racedCall });
		await assert.rejects(actions.execute(43, challenge.actionId, { approved: true, sandboxId: workspaceId, call: racedCall }));
		const raced = await Promise.allSettled([actions.execute(42, challenge.actionId, { approved: true, sandboxId: workspaceId, call: racedCall }), actions.execute(42, challenge.actionId, { approved: true, sandboxId: workspaceId, call: racedCall })]);
		assert.equal(raced.filter(item => item.status === "fulfilled").length, 1);
		assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM playground_agent_actions WHERE status='complete'")).rows[0].count), 4);
		assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM playground_agent_actions WHERE tool_name='question'")).rows[0].count), 0);
		for (let attempt = 0; attempt < 40; attempt++) {
			const count = Number((await pool.query("SELECT COUNT(*) AS count FROM playground_run_events WHERE kind='tool.finished'")).rows[0].count);
			if (count === 4) break; await new Promise(resolve => setTimeout(resolve, 50));
		}
		const durable = (await pool.query("SELECT kind,payload FROM playground_run_events WHERE kind LIKE 'tool.%'")).rows;
		assert.equal(durable.filter(row => row.kind === "tool.finished").length, 4);
		assert.doesNotMatch(JSON.stringify(durable), /signed-agent-smoke|python3 main.py|Which database|PostgreSQL|Accessibility|café/);
		console.log("PASS: real Docker + PostgreSQL native fixture questions/read/write/read/conversation, fresh consent, metadata-only evidence, cross-account refusal and concurrent one-shot dispatch. Model/billing are fixtures, not live qualification.");
	} finally {
		if (workspaceId) { try { await sandboxes.request(42, "DELETE", `/sandboxes/${workspaceId}`); } catch { /* Outer smoke scope also removes its own workload labels. */ } }
		globalThis.fetch = fetch; actions.onModuleDestroy(); await pool.end();
	}
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Agent smoke failed"); process.exitCode = 1; });
