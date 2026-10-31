import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter, once } from "node:events";
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard";
import { PlaygroundAgentTicketsService, executableCall } from "../src/desktop/playground-agent-tickets.service";
import { PlaygroundAgentActionsService } from "../src/desktop/playground-agent-actions.service";
import { PlaygroundAgentActionsController } from "../src/desktop/playground-agent-actions.controller";
import { PlaygroundSandboxService } from "../src/desktop/playground-sandbox.service";
import { DesktopGatewayService } from "../src/desktop/desktop-gateway.service";
import { AGENT_ACTIONS_SCHEMA } from "../src/desktop/playground-agent-actions.schema";
import type { DatabaseService } from "../src/database/database.service";
import type { PlaygroundRunEventsService } from "../src/desktop/playground-run-events.service";
import type { BillingService } from "../src/billing/billing.service";
import type { AddonsService } from "../src/billing/addons.service";
import type { AgentCall, AgentRequest, AgentReply } from "../src/desktop/playground-agent-contract";
import type { DesktopWebService } from "../src/desktop/desktop-web.service";

const fixture = JSON.parse(readFileSync(join(__dirname, "../../tests/fixtures/playground-agent.json"), "utf8"));
const sandboxId = "00000000-0000-4000-8000-000000000042";
const runId = "dsk-0123456789abcdef01234567";
const write: AgentCall = { id: "call_1", name: "write_file", arguments: '{"path":"main.py","text":"sensitive source text"}' };
const command: AgentCall = { id: "call_1", name: "run_command", arguments: '{"command":"python3 main.py"}' };
const build = (call = write) => ({ request: { ...fixture.request, mode: "build" } as AgentRequest, reply: { ...fixture.reply, tool_calls: [call] } as AgentReply });
async function enabled(work: () => Promise<void>) {
	const values = { PLAYGROUND_AGENT_EXECUTION_ENABLED: "true", PLAYGROUND_AGENT_ACTION_KEY: "test-only-" + "k".repeat(40), PLAYGROUND_AGENT_MODEL_FILES: "LFM2.5-230M-Q4_K_M.gguf", AI_SERVICE_KEY: "internal-fixture" };
	const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
	Object.assign(process.env, values);
	try { await work(); } finally { for (const key of Object.keys(values)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
}
function setup(web?: DesktopWebService) {
	const tickets = new PlaygroundAgentTicketsService(); const rows: Array<Record<string, unknown>> = []; const sql: Array<{ text: string; values: unknown[] }> = [];
	let failClaim = false, failCommit = false; const calls: string[] = []; const recorded: Array<{ kind: string; options: unknown }> = [];
	const pool = { query: async (text: string, values: unknown[] = []) => {
		sql.push({ text, values });
		if (text.startsWith("INSERT")) {
			if (rows.some(row => row.account_id === values[1] && row.model_run_id === values[2] && row.tool_call_id === values[8])) return { rows: [] };
			const row = { action_id: values[0], account_id: values[1], model_run_id: values[2], execution_run_id: values[3], session_uuid: values[4], scope: values[5], model_key: values[6], sandbox_id: values[7], tool_call_id: values[8], tool_name: values[9], arguments_sha256: values[10], mode: values[11], effect: values[12], expires_at: new Date(Number(values[13]) * 1000), status: "pending" };
			rows.push(row); return { rows: [{ ...row }] };
		}
		if (text.startsWith("SELECT")) return { rows: rows.filter(row => text.includes("action_id=$1") ? row.action_id === values[0] && row.account_id === values[1] : row.account_id === values[0] && row.model_run_id === values[1] && row.tool_call_id === values[2]).map(row => ({ ...row })) };
		if (text.includes("SET status=$3")) {
			if (failClaim) throw new Error("Database unavailable");
			const row = rows.find(row => row.action_id === values[0] && row.account_id === values[1] && row.status === "pending" && new Date(row.expires_at as Date).getTime() > Date.now());
			if (!row) return { rows: [] }; row.status = values[2]; return { rows: [{ ...row }] };
		}
		if (text.includes("SET status='complete'")) {
			if (failCommit) throw new Error("Outcome commit unavailable");
			const row = rows.find(row => row.action_id === values[0] && row.status === "executing");
			if (!row) return { rows: [] }; row.status = "complete"; return { rows: [{ action_id: row.action_id }] };
		}
		if (text.includes("SET status='failed'")) { const row = rows.find(row => row.action_id === values[0] && row.status === "executing"); if (row) row.status = "failed"; return { rows: [] }; }
		return { rows: [] };
	} };
	const broker = {
		request: async (_account: number, method: string, path: string, body?: unknown, _signal?: AbortSignal) => {
			calls.push(method + " " + path);
			if (path === "/health") return { available: true, location: "hosted-docker", network: "disabled", policyVersion: 2, descendantPolicy: "freeze-check-discard" };
			if (method === "DELETE") return { stopped: true };
			if (method === "PUT") return { path: "main.py", bytes: Buffer.byteLength((body as { text: string }).text) };
			if (path.includes("/file?")) return { path: "src/main.py", text: "file source" };
			return { id: sandboxId, location: "hosted-docker", policyVersion: 2 };
		},
		agentCommand: async () => { calls.push("COMMAND"); return { stdout: "test output", stderr: "", exitCode: 0, timedOut: false, durationMs: 10 }; },
	};
	const observed = new EventEmitter();
	const events = { record: async (_account: number, _run: string, kind: string, options: unknown) => { recorded.push({ kind, options }); observed.emit(kind); } } as unknown as PlaygroundRunEventsService;
	const waitForEvent = async (kind: string) => { if (!recorded.some(event => event.kind === kind)) await once(observed, kind, { signal: AbortSignal.timeout(3000) }); };
	const service = new PlaygroundAgentActionsService({ getPool: () => pool } as unknown as DatabaseService, tickets, broker as unknown as PlaygroundSandboxService, events, web);
	const prepare = async (call = write) => {
		const { request, reply } = build(call); const ticket = tickets.issue(42, request, reply, runId, "playground")[0].token;
		return service.prepare(42, { ticket, sandboxId, call });
	};
	return { service, tickets, rows, sql, broker, calls, recorded, prepare, waitForEvent, pool, events, failClaim: () => { failClaim = true; }, failCommit: () => { failCommit = true; } };
}

test("action APIs stay JWT-guarded and default-disabled without creating a workspace", async () => {
	assert.ok(Reflect.getMetadata(GUARDS_METADATA, PlaygroundAgentActionsController).includes(JwtAuthGuard));
	const state = setup(); const old = process.env.PLAYGROUND_AGENT_EXECUTION_ENABLED; delete process.env.PLAYGROUND_AGENT_EXECUTION_ENABLED;
	try { assert.equal((await state.service.capabilities(42)).enabled, false); await assert.rejects(state.service.prepare(42, {}), ServiceUnavailableException); assert.equal(state.calls.length, 0); }
	finally { if (old !== undefined) process.env.PLAYGROUND_AGENT_EXECUTION_ENABLED = old; }
});

test("execution policy is fixed independently of native client schemas/effects", () => {
	assert.equal(executableCall(write, "build").effect, "mutation"); assert.throws(() => executableCall(write, "plan"));
	for (const call of [{ ...write, arguments: '{"path":"../escape","text":"x"}' }, { ...write, arguments: '{"path":"a","path":"b","text":"x"}' }, { ...write, arguments: '{"path":"a","text":"x","extra":true}' }, { ...write, name: "custom_tool" }, { ...write, effect: "read_only" }]) assert.throws(() => executableCall(call, "build"));
});

test("signed proposal tickets bind account, model receipt, mode, tool ID and exact argument bytes", async () => enabled(async () => {
	const state = setup(); const { request, reply } = build(); const ticket = state.tickets.issue(42, request, reply, runId, "playground")[0];
	assert.equal(state.tickets.verify(ticket.token, 42, write).claims.run, runId);
	assert.throws(() => state.tickets.verify(ticket.token, 43, write));
	assert.throws(() => state.tickets.verify(ticket.token, 42, { ...write, id: "different" }));
	assert.throws(() => state.tickets.verify(ticket.token, 42, { ...write, arguments: write.arguments + " " }));
	assert.throws(() => state.tickets.verify(ticket.token.slice(0, -3) + "abc", 42, write));
}));

test("expired tickets and removal of model qualification fail closed", async t => enabled(async () => {
	const { tickets } = setup(); const { request, reply } = build(); const issued = tickets.issue(42, request, reply, runId, "playground")[0]; const now = Date.now();
	t.mock.method(Date, "now", () => now + 301_000); assert.throws(() => tickets.verify(issued.token, 42, write)); t.mock.restoreAll();
	process.env.PLAYGROUND_AGENT_MODEL_FILES = ""; assert.throws(() => tickets.verify(issued.token, 42, write));
}));

test("preparing converges on one metadata-only action and never executes or stores arguments", async () => enabled(async () => {
	const state = setup(); const first = await state.prepare(); const second = await state.prepare();
	assert.equal(first.actionId, second.actionId); assert.equal(state.rows.length, 1); assert.equal(first.requiresApproval, true);
	assert.equal(state.calls.some(value => value.startsWith("PUT") || value === "COMMAND"), false);
	assert.doesNotMatch(JSON.stringify(state.rows) + JSON.stringify(state.sql), /sensitive source text/);
}));

test("a denied action is consumed without broker dispatch or fabricated execution evidence", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare();
	const result = await state.service.execute(42, action.actionId, { approved: false, sandboxId, call: write });
	assert.equal(result.executed, false); assert.equal(state.rows[0].status, "declined"); assert.equal(state.calls.some(value => value.startsWith("PUT")), false);
	assert.equal(state.recorded.some(event => event.kind === "tool.started"), false);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: write }), ConflictException);
}));

test("web search is ticket-bound, requires approval and uses the hosted provider once", async () => enabled(async () => {
	const queries: string[] = [];
	const web = { search: async (query: string) => { queries.push(query); return [{ title: "Example", url: "https://example.com/", snippet: "Result" }]; } } as unknown as DesktopWebService;
	const state = setup(web);
	const call: AgentCall = { id: "search1", name: "web_search", arguments: '{"query":"coffee"}' };
	assert.equal(executableCall(call, "plan").effect, "read_only");
	const action = await state.prepare(call);
	assert.equal(action.requiresApproval, true);
	assert.deepEqual(queries, []);
	const result = await state.service.execute(42, action.actionId, { approved: true, sandboxId, call });
	assert.equal(result.executed, true);
	assert.deepEqual(queries, ["coffee"]);
	assert.match(JSON.stringify(result), /example\.com/);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call }), ConflictException);
	assert.deepEqual(queries, ["coffee"]);
}));

test("concurrent approve/execute requests dispatch once and trust only observed broker output", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare(command);
	const replies = await Promise.allSettled([state.service.execute(42, action.actionId, { approved: true, sandboxId, call: command }), state.service.execute(42, action.actionId, { approved: true, sandboxId, call: command })]);
	assert.equal(replies.filter(value => value.status === "fulfilled").length, 1); assert.equal(state.calls.filter(value => value === "COMMAND").length, 1);
	await state.waitForEvent("tool.finished");
	assert.equal(state.rows[0].status, "complete"); assert.ok(state.recorded.some(event => event.kind === "tool.finished"));
	assert.deepEqual(state.recorded.map(event => event.kind), ["tool.approval", "tool.started", "tool.finished"]);
	assert.doesNotMatch(JSON.stringify(state.recorded), /python3 main.py|test output/);
	await assert.rejects(state.prepare(command), ConflictException);
}));

test("cross-account, changed arguments/workspace and non-boolean decisions cannot consume a pending action", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare();
	await assert.rejects(state.service.execute(43, action.actionId, { approved: true, sandboxId, call: write }), NotFoundException);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId: "00000000-0000-4000-8000-000000000099", call: write }), ConflictException);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: { ...write, arguments: '{"path":"main.py","text":"changed"}' } }), ConflictException);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: "true", sandboxId, call: write }), BadRequestException);
	assert.equal(state.rows[0].status, "pending"); assert.equal(state.calls.some(value => value.startsWith("PUT")), false);
}));

test("database claim failure prevents dispatch; outcome commit failure invalidates the workload", async () => enabled(async () => {
	const before = setup(); const first = await before.prepare(); before.failClaim();
	await assert.rejects(before.service.execute(42, first.actionId, { approved: true, sandboxId, call: write })); assert.equal(before.calls.some(value => value.startsWith("PUT")), false);
	const after = setup(); const second = await after.prepare(); after.failCommit();
	await assert.rejects(after.service.execute(42, second.actionId, { approved: true, sandboxId, call: write }), ServiceUnavailableException);
	assert.equal(after.rows[0].status, "failed"); assert.equal(after.calls.filter(value => value.startsWith("DELETE")).length, 1);
}));

test("a stopped/non-quiescent broker result fails closed and is never retried", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare(command); state.broker.agentCommand = async () => { state.calls.push("COMMAND"); return { stdout: "", stderr: "", exitCode: -1, timedOut: true, durationMs: 10 }; };
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: command }), ServiceUnavailableException);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: command }), ConflictException);
	await state.waitForEvent("tool.failed");
	assert.equal(state.calls.filter(value => value === "COMMAND").length, 1); assert.ok(state.recorded.some(event => event.kind === "tool.failed"));
}));

test("tickets are issued only after successful model settlement, never after billing failure", async t => enabled(async () => {
	let issued = 0, fail = true;
	const billing = { getBalance: async () => ({ canGenerate: true }), getAllowance: async () => ({ remainingRon: 0 }), recordUsage: async () => { if (fail) throw new Error(); } } as unknown as BillingService;
	const addons = { resolveSpectreAccess: async () => ({ hasAccess: true, source: "addon" }) } as unknown as AddonsService;
	const tickets = { issue: () => { issued++; return []; } } as unknown as PlaygroundAgentTicketsService;
	const gateway = new DesktopGatewayService(billing, addons, undefined, tickets);
	t.mock.method(globalThis, "fetch", async () => Response.json(fixture.reply));
	assert.equal((await gateway.agentTurn(42, "pro", fixture.request, "playground")).kind, "refused"); assert.equal(issued, 0);
	fail = false; assert.equal((await gateway.agentTurn(42, "pro", fixture.request, "playground")).kind, "completed"); assert.equal(issued, 1);
}));

test("bootstrap and SQL migration share the same one-shot metadata schema", () => {
	const migration = readFileSync(join(__dirname, "../data/migrations/2026-10-playground-agent-actions.sql"), "utf8").replace(/^--.*$/gm, "").replace(/\r\n/g, "\n").trim();
	assert.equal(migration, AGENT_ACTIONS_SCHEMA.replace(/\r\n/g, "\n").trim()); assert.match(migration, /UNIQUE \(account_id, model_run_id, tool_call_id\)/);
	assert.doesNotMatch(migration, /arguments_json|stdout|stderr|source_text/);
});

test("cancellation immediately after the atomic claim prevents dispatch and cannot reopen the claim", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare(command); const cancel = new AbortController();
	const query = state.pool.query; state.pool.query = async (...args) => { const result = await query(...args); if (args[0].includes("SET status=$3")) cancel.abort(); return result; };
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: command }, cancel.signal), ServiceUnavailableException);
	assert.equal(state.calls.includes("COMMAND"), false); assert.equal(state.calls.some(call => call.startsWith("DELETE")), false);
	assert.equal(state.rows[0].status, "failed");
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: command }), ConflictException);
}));

test("cancellation after dispatch uses independent cleanup and never retries the action", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare(command); const cancel = new AbortController();
	state.broker.agentCommand = async () => { state.calls.push("COMMAND"); cancel.abort(); return { stdout: "unconfirmed", stderr: "", exitCode: 0, timedOut: false, durationMs: 10 }; };
	const request = state.broker.request;
	state.broker.request = async (...args: Parameters<typeof request>) => { if (args[1] === "DELETE") { assert.equal(cancel.signal.aborted, true); assert.equal(args[4]?.aborted, false); } return request(...args); };
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: command }, cancel.signal), ServiceUnavailableException);
	assert.equal(state.calls.filter(call => call === "COMMAND").length, 1); assert.equal(state.calls.filter(call => call.startsWith("DELETE")).length, 1);
	assert.equal(state.rows[0].status, "failed");
}));

test("an unavailable recorder cannot block dispatch or become one-shot execution authority", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare(command);
	let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
	state.events.record = async () => paused;
	const reply = await state.service.execute(42, action.actionId, { approved: true, sandboxId, call: command });
	assert.equal(reply.executed, true); assert.equal(state.calls.filter(call => call === "COMMAND").length, 1);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: command }), ConflictException);
	release();
}));
