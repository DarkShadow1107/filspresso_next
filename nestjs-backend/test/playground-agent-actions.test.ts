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
import { DesktopWebService } from "../src/desktop/desktop-web.service";

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
function setup(web?: DesktopWebService, documents?: Record<string, any>) {
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
			if (path.endsWith("/files")) return { files: ["main.py"] };
			if (path.includes("/file?")) return { path: "src/main.py", text: "file source" };
			return { id: sandboxId, location: "hosted-docker", policyVersion: 2 };
		},
		agentCommand: async () => { calls.push("COMMAND"); return { stdout: "test output", stderr: "", exitCode: 0, timedOut: false, durationMs: 10 }; },
	};
	const observed = new EventEmitter();
	const events = { record: async (_account: number, _run: string, kind: string, options: unknown) => { recorded.push({ kind, options }); observed.emit(kind); } } as unknown as PlaygroundRunEventsService;
	const waitForEvent = async (kind: string) => { if (!recorded.some(event => event.kind === kind)) await once(observed, kind, { signal: AbortSignal.timeout(3000) }); };
	const service = new PlaygroundAgentActionsService({ getPool: () => pool } as unknown as DatabaseService, tickets, broker as unknown as PlaygroundSandboxService, events, web, documents as any);
	const prepare = async (call = write) => {
		const { request, reply } = build(call); const ticket = tickets.issue(42, request, reply, runId, call.name === "run_command" ? "desktop" : "playground")[0].token;
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
	assert.equal(executableCall({ id: "list1", name: "list_files", arguments: "{}" }, "plan").effect, "read_only");
	assert.throws(() => executableCall({ id: "page1", name: "fetch_page", arguments: '{"url":"ftp://example.com/"}' }, "plan"), /Invalid public page URL/);
	assert.throws(() => executableCall({ id: "doc1", name: "save_document", arguments: '{"name":"x","content":"y"}' }, "plan"));
});

test("web scope never receives a command action ticket", async () => enabled(async () => {
	const { request, reply } = build(command);
	const tickets = new PlaygroundAgentTicketsService();
	assert.deepEqual(tickets.issue(42, request, reply, runId, "playground"), []);
	assert.equal(tickets.issue(42, request, reply, runId, "desktop").length, 1);
}));

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

test("public page fetch is DNS-fenced by the service, ticket-bound and separately approved", async () => enabled(async () => {
	const urls: string[] = [];
	const web = { fetchPage: async (url: string, limit: number) => { urls.push(url); assert.equal(limit, 16_000); return { url, finalUrl: url, title: "Example", text: "Untrusted page", truncated: false }; } } as unknown as DesktopWebService;
	const state = setup(web);
	const call: AgentCall = { id: "fetch1", name: "fetch_page", arguments: '{"url":"https://example.com/"}' };
	assert.equal(executableCall(call, "plan").effect, "read_only");
	const action = await state.prepare(call);
	assert.equal(action.requiresApproval, true); assert.deepEqual(urls, []);
	const result = await state.service.execute(42, action.actionId, { approved: true, sandboxId, call });
	assert.equal(result.executed, true); assert.match(JSON.stringify(result), /Untrusted page/); assert.deepEqual(urls, ["https://example.com/"]);
}));

test("combined research is a separate one-shot consent and reads at most three fenced pages", async () => enabled(async () => {
	const urls: string[] = []; let searches = 0;
	const web = { search: async () => { searches++; return Array.from({ length: 5 }, (_, i) => ({ title: `Source ${i}`, url: `https://example.com/${i}`, snippet: "snippet" })); },
		fetchPage: async (url: string, limit: number) => { urls.push(url); assert.equal(limit, 12_000); if (url.endsWith("/1")) throw new Error("blocked"); return { url, finalUrl: url, title: "Source", text: "Evidence", truncated: false }; } } as unknown as DesktopWebService;
	const state = setup(web); const call: AgentCall = { id: "research1", name: "research_web", arguments: '{"query":"engines"}' };
	const action = await state.prepare(call); assert.equal(action.requiresApproval, true); assert.equal(searches, 0);
	const result = await state.service.execute(42, action.actionId, { approved: true, sandboxId, call });
	assert.equal(searches, 1); assert.equal(urls.length, 3); assert.match(JSON.stringify(result), /Evidence/); assert.match(JSON.stringify(result), /unavailable or refused/);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call }), ConflictException);
}));

test("research uses semantic excerpts after fenced fetching and falls back on ranker failure", async () => enabled(async () => {
	let ranked = 0;
	const web = { search: async () => [{ title: "Source", url: "https://example.com/a", snippet: "text" }, { title: "Other", url: "https://example.com/b", snippet: "text" }],
		fetchPage: async (url: string) => ({ finalUrl: url, title: "Source", text: url.endsWith("/a") ? "semantic evidence" : "lexical evidence" }),
		rankResearchPassages: async (_query: string, text: string) => { ranked++; if (text.startsWith("lexical")) throw new Error("unavailable"); return text; } } as unknown as DesktopWebService;
	const state = setup(web); const call: AgentCall = { id: "research_semantic", name: "research_web", arguments: '{"query":"evidence"}' };
	const action = await state.prepare(call);
	const result = await state.service.execute(42, action.actionId, { approved: true, sandboxId, call });
	const pages = JSON.parse(result.result.stdout).pages;
	assert.equal(ranked, 2); assert.equal(pages[0].ranking, "minilm-cosine"); assert.equal(pages[0].text, "semantic evidence");
	assert.equal(pages[1].ranking, "lexical"); assert.equal(pages[1].text, "lexical evidence");
}));

test("semantic ranker sends bounded text and uses only returned indices", async t => enabled(async () => {
	const source = "A".repeat(900) + "B".repeat(900) + "C".repeat(100);
	t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		assert.equal(body.passages.length, 3); assert.equal(body.query, "question");
		assert.equal(new Headers(init.headers).get("x-ai-service-key"), "internal-fixture");
		return Response.json({ indices: [2, 1, 0], method: "minilm-cosine" });
	});
	assert.equal(await new DesktopWebService().rankResearchPassages("question", source), "B".repeat(900) + " … " + "C".repeat(100));
}));

test("semantic ranker rejects duplicate indices", async t => enabled(async () => {
	t.mock.method(globalThis, "fetch", async () => Response.json({ indices: [0, 0], method: "minilm-cosine" }));
	await assert.rejects(new DesktopWebService().rankResearchPassages("question", "A".repeat(1000)), /Invalid ranking/);
}));

test("declining combined research makes no search or page request", async () => enabled(async () => {
	let calls = 0;
	const web = { search: async () => { calls++; return []; }, fetchPage: async () => { calls++; } } as unknown as DesktopWebService;
	const state = setup(web); const call: AgentCall = { id: "research_denied", name: "research_web", arguments: '{"query":"engines"}' };
	const action = await state.prepare(call);
	await state.service.execute(42, action.actionId, { approved: false, sandboxId, call });
	assert.equal(calls, 0);
}));

test("server date is a local clock result with no approval and no tool dispatch beyond ownership probes", async () => enabled(async () => {
	const state = setup(); const call: AgentCall = { id: "date1", name: "server_date", arguments: "{}" };
	const action = await state.prepare(call);
	assert.equal(action.requiresApproval, false);
	const result = await state.service.execute(42, action.actionId, { approved: true, sandboxId, call });
	assert.equal(result.executed, true);
	const parsed = JSON.parse(result.result.stdout) as { date: string; timestamp: string; timezone: string; source: string };
	assert.match(parsed.date, /^\d{4}-\d{2}-\d{2}$/); assert.equal(parsed.timezone, "UTC"); assert.match(parsed.source, /clock/);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call }), ConflictException);
	// The clock tool never reaches a broker tool endpoint; even retries only re-verify ownership.
	assert.ok(state.calls.length > 0 && state.calls.every(entry => entry === `GET /sandboxes/${sandboxId}`));
	assert.equal(state.calls.some(entry => entry.startsWith("PUT") || entry.startsWith("DELETE") || entry === "COMMAND"), false);
}));

test("workspace listing is a bounded read-only broker action", async () => enabled(async () => {
	const state = setup();
	const call: AgentCall = { id: "files1", name: "list_files", arguments: "{}" };
	const action = await state.prepare(call); assert.equal(action.requiresApproval, false);
	const result = await state.service.execute(42, action.actionId, { approved: true, sandboxId, call });
	assert.equal(result.executed, true); assert.match(JSON.stringify(result), /main.py/);
	assert.equal(state.calls.some(value => value === "GET /sandboxes/00000000-0000-4000-8000-000000000042/files"), true);
}));

test("workspace listing and account documents stay account scoped; document writes/deletes require approval", async () => enabled(async () => {
	const seen: unknown[] = [];
	const docs = {
		list: async (account: number) => { seen.push(["list", account]); return { version: 1, documents: [{ id: "00000000-0000-4000-8000-000000000011", name: "Notes", content_bytes: 14 }] }; },
		get: async (account: number, id: string) => { seen.push(["get", account, id]); return { id, name: "Notes", content: "private account note" }; },
		create: async (account: number, input: unknown) => { seen.push(["create", account, input]); return { id: "00000000-0000-4000-8000-000000000012", name: "Saved", content_bytes: 5 }; },
		delete: async (account: number, id: string, name: string) => { seen.push(["delete", account, id, name]); return true; },
	};
	const state = setup(undefined, docs);
	const listingCall: AgentCall = { id: "listdocs", name: "list_documents", arguments: "{}" };
	const listing = await state.prepare(listingCall); assert.equal(listing.requiresApproval, false);
	const listed = await state.service.execute(42, listing.actionId, { approved: true, sandboxId, call: listingCall });
	assert.match(JSON.stringify(listed), /Notes/);
	const readCall: AgentCall = { id: "readdoc", name: "read_document", arguments: '{"id":"00000000-0000-4000-8000-000000000011"}' };
	const read = await state.prepare(readCall); assert.equal(read.requiresApproval, false);
	const readResult = await state.service.execute(42, read.actionId, { approved: true, sandboxId, call: readCall }); assert.match(JSON.stringify(readResult), /private account note/);
	const saveCall: AgentCall = { id: "savedoc", name: "save_document", arguments: '{"name":"Saved","content":"hello"}' };
	const save = await state.prepare(saveCall); assert.equal(save.requiresApproval, true);
	await state.service.execute(42, save.actionId, { approved: true, sandboxId, call: saveCall });
	const deleteCall: AgentCall = { id: "deletedoc", name: "delete_document", arguments: '{"id":"00000000-0000-4000-8000-000000000011","name":"Notes"}' };
	const remove = await state.prepare(deleteCall); assert.equal(remove.requiresApproval, true);
	await state.service.execute(42, remove.actionId, { approved: true, sandboxId, call: deleteCall });
	assert.deepEqual(seen.map(item => (item as unknown[])[0]), ["list", "get", "create", "delete"]);
	assert.ok(seen.every(item => (item as unknown[])[1] === 42));
	assert.equal((seen[3] as unknown[])[3], "Notes");
}));

test("concurrent approve/execute requests dispatch once and trust only observed broker output", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare(write);
	const replies = await Promise.allSettled([state.service.execute(42, action.actionId, { approved: true, sandboxId, call: write }), state.service.execute(42, action.actionId, { approved: true, sandboxId, call: write })]);
	assert.equal(replies.filter(value => value.status === "fulfilled").length, 1); assert.equal(state.calls.filter(value => value.startsWith("PUT")).length, 1);
	await state.waitForEvent("tool.finished");
	assert.equal(state.rows[0].status, "complete"); assert.ok(state.recorded.some(event => event.kind === "tool.finished"));
	assert.deepEqual(state.recorded.map(event => event.kind), ["tool.approval", "tool.started", "tool.finished"]);
	assert.doesNotMatch(JSON.stringify(state.recorded), /sensitive source text/);
	await assert.rejects(state.prepare(write), ConflictException);
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

test("an unconfirmed broker write fails closed and is never retried", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare(write); const request = state.broker.request;
	state.broker.request = async (...args: Parameters<typeof request>) => { if (args[1] === "PUT") { state.calls.push("PUT interrupted"); throw new Error("Unconfirmed write"); } return request(...args); };
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: write }), ServiceUnavailableException);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: write }), ConflictException);
	await state.waitForEvent("tool.failed");
	assert.equal(state.calls.filter(value => value === "PUT interrupted").length, 1); assert.ok(state.recorded.some(event => event.kind === "tool.failed"));
}));

test("desktop-scoped command tickets cannot dispatch through the web action service", async () => enabled(async () => {
	const state = setup();
	await assert.rejects(state.prepare(command), BadRequestException);
	assert.equal(state.calls.includes("COMMAND"), false);
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
	const state = setup(); const action = await state.prepare(write); const cancel = new AbortController();
	const query = state.pool.query; state.pool.query = async (...args) => { const result = await query(...args); if (args[0].includes("SET status=$3")) cancel.abort(); return result; };
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: write }, cancel.signal), ServiceUnavailableException);
	assert.equal(state.calls.some(call => call.startsWith("PUT")), false); assert.equal(state.calls.some(call => call.startsWith("DELETE")), false);
	assert.equal(state.rows[0].status, "failed");
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: write }), ConflictException);
}));

test("cancellation after dispatch uses independent cleanup and never retries the action", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare(write); const cancel = new AbortController();
	const request = state.broker.request;
	state.broker.request = async (...args: Parameters<typeof request>) => { if (args[1] === "PUT") { state.calls.push("PUT interrupted"); cancel.abort(); return { path: "main.py", bytes: Buffer.byteLength("sensitive source text") }; } if (args[1] === "DELETE") { assert.equal(cancel.signal.aborted, true); assert.equal(args[4]?.aborted, false); } return request(...args); };
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: write }, cancel.signal), ServiceUnavailableException);
	assert.equal(state.calls.filter(call => call === "PUT interrupted").length, 1); assert.equal(state.calls.filter(call => call.startsWith("DELETE")).length, 1);
	assert.equal(state.rows[0].status, "failed");
}));

test("an unavailable recorder cannot block dispatch or become one-shot execution authority", async () => enabled(async () => {
	const state = setup(); const action = await state.prepare(write);
	let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
	state.events.record = async () => paused;
	const reply = await state.service.execute(42, action.actionId, { approved: true, sandboxId, call: write });
	assert.equal(reply.executed, true); assert.equal(state.calls.filter(call => call.startsWith("PUT")).length, 1);
	await assert.rejects(state.service.execute(42, action.actionId, { approved: true, sandboxId, call: write }), ConflictException);
	release();
}));
