/** Real Docker + PostgreSQL, deliberately FIXTURE model/billing. No live inference or money.
 * Invoked only by playground-sandbox/Smoke-Agent.ps1 against its temporary loopback services. */
import assert from "node:assert/strict";
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
	process.env.AI_SERVICE_KEY = "fixture-only-no-live-model";
	process.env.PYTHON_AI_HOST = "http://fixture-ai";
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
	const replies = [[question], [read("read_missing")], [write], [read("read_written")], [command], [], [], [{ ...write, id: "write_race" }]];
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		if (String(input).startsWith("http://fixture-ai/")) {
			requests.push(JSON.parse(String(init?.body))); const calls = replies.shift(); assert.ok(calls);
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
			turn: async (request, signal) => { const reply = await gateway.agentTurn(42, "pro", request, "playground", signal); if (reply.kind !== "completed") throw new Error(reply.error); return reply.payload; },
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
			assert.ok(pending.call.arguments === write.arguments || pending.call.arguments === command.arguments, "Only trusted literal fixture actions are allowed");
			approvals++; consent.decide(pending.id, true);
		});
		const questions = new AgentQuestionQueue(); let questionCount = 0;
		questions.subscribe(() => { const pending = questions.getSnapshot(); if (!pending) return; questionCount++;
			assert.equal(consent.decide(pending.id, true), false);
			questions.answer({ version: 1, id: pending.id, cancelled: false, answers: questionFixture.answers });
		});
		const services = new HostedAgentServices({ id: workspaceId, location: "hosted-docker" }, gateway.agentModels(), consent, io, undefined, questions);
		const output: AgentLoopEvent[] = [];
		for await (const event of new NativeAgentLoop(services).run({ model: "lfm2_5_230m_q4_k_m", inputContextTokens: 16_384 }, "build", "Fixture read, write, read and test.")) output.push(event);
		assert.equal(output.at(-1)?.kind, "finished"); assert.equal(charges.length, 6); assert.equal(approvals, 2); assert.equal(questionCount, 1);
		const calls = output.filter((event): event is Extract<AgentLoopEvent, { kind: "tool.finished" }> => event.kind === "tool.finished");
		assert.equal(calls.length, 4); assert.equal(calls[0].invocation.result.exitCode, 1);
		assert.equal(calls[2].invocation.result.stdout, "print('signed-agent-smoke')\n");
		assert.equal(calls[3].invocation.result.stdout.trim(), "signed-agent-smoke");
		assert.equal(requests[5].history.length, 5); assert.equal(requests[5].system_prompt, AGENT_SYSTEM_PROMPT);
		for (const group of requests[5].history) assert.equal(group.tool_calls[0].id, group.tool_results[0].tool_call_id);
		assert.equal(JSON.parse(requests[5].history[0].tool_results[0].content).grantsExecutionPermission, false);
		const finished = output.at(-1); assert.equal(finished?.kind, "finished");
		if (finished?.kind !== "finished") throw new Error("Missing completed conversation");
		for await (const event of new NativeAgentLoop(services).run({ model: "lfm2_5_230m_q4_k_m", inputContextTokens: 16_384 }, "build", "Fixture conversation follow-up.", new AbortController().signal, [finished.conversationTurn])) output.push(event);
		assert.equal(charges.length, 7); assert.equal(requests[6].conversation?.length, 1); assert.equal(approvals, 2);
		// Exercise the database CAS with genuinely concurrent dispatch attempts, not a mocked pool.
		const request = buildProposalReview({ model: "lfm2_5_230m_q4_k_m", inputContextTokens: 16_384 }, "build", "Fixture concurrent approval test.");
		const racedReply = await io.turn(request, new AbortController().signal); const racedCall = racedReply.tool_calls[0];
		const challenge = await actions.prepare(42, { ticket: racedReply.action_tickets![0].token, sandboxId: workspaceId, call: racedCall });
		await assert.rejects(actions.execute(43, challenge.actionId, { approved: true, sandboxId: workspaceId, call: racedCall }));
		const raced = await Promise.allSettled([actions.execute(42, challenge.actionId, { approved: true, sandboxId: workspaceId, call: racedCall }), actions.execute(42, challenge.actionId, { approved: true, sandboxId: workspaceId, call: racedCall })]);
		assert.equal(raced.filter(item => item.status === "fulfilled").length, 1);
		assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM playground_agent_actions WHERE status='complete'")).rows[0].count), 5);
		assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM playground_agent_actions WHERE tool_name='question'")).rows[0].count), 0);
		for (let attempt = 0; attempt < 40; attempt++) {
			const count = Number((await pool.query("SELECT COUNT(*) AS count FROM playground_run_events WHERE kind='tool.finished'")).rows[0].count);
			if (count === 5) break; await new Promise(resolve => setTimeout(resolve, 50));
		}
		const durable = (await pool.query("SELECT kind,payload FROM playground_run_events WHERE kind LIKE 'tool.%'")).rows;
		assert.equal(durable.filter(row => row.kind === "tool.finished").length, 5);
		assert.doesNotMatch(JSON.stringify(durable), /signed-agent-smoke|python3 main.py|Which database|PostgreSQL|Accessibility|café/);
		console.log("PASS: real Docker + PostgreSQL native fixture questions/read/write/read/test/conversation, separate fresh consent, metadata-only evidence, cross-account refusal and concurrent one-shot dispatch. Model/billing are fixtures, not live qualification.");
	} finally {
		if (workspaceId) { try { await sandboxes.request(42, "DELETE", `/sandboxes/${workspaceId}`); } catch { /* Outer smoke scope also removes its own workload labels. */ } }
		globalThis.fetch = fetch; actions.onModuleDestroy(); await pool.end();
	}
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Agent smoke failed"); process.exitCode = 1; });
