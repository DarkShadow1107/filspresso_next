import "./test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Response as ExpressResponse } from "express";
import type { BillingService } from "../src/billing/billing.service";
import type { AddonsService } from "../src/billing/addons.service";
import type { DatabaseService } from "../src/database/database.service";
import {
	MAX_EVENTS_PER_RUN,
	MAX_EVENT_TEXT,
	RUN_EVENT_KIND_SET,
	PlaygroundRunEventsService,
	normalizeRunId,
	normalizeSessionUuid,
	sanitizeEventPayload,
} from "../src/desktop/playground-run-events.service";
import { DesktopGatewayService } from "../src/desktop/desktop-gateway.service";
import { PlaygroundSandboxService } from "../src/desktop/playground-sandbox.service";

type StoredInsert = {
	accountId: number;
	runId: string;
	sessionUuid: string | null;
	scope: string;
	kind: string;
	sequence: number;
	status: string;
	modelKey: string | null;
	payload: Record<string, unknown>;
};

/**
 * Only what a stored row asserts is scripted. The fake answers the four statement shapes
 * the recorder really issues; anything else is a bug this suite wants to hear about.
 */
class FakePool {
	inserts: StoredInsert[] = [];
	replayArgs: { accountId: number; runId: string; limit: number; after: number } | null = null;
	seededSequence = -1;
	insertShouldFail = false;
	purged = 0;

	async connect() {
		return {
			query: async (sql: string, params: unknown[] = []) => {
				if (sql.includes("INSERT INTO playground_run_events")) {
					if (this.insertShouldFail) throw new Error("synthetic write failure");
					this.inserts.push({
						accountId: params[0] as number,
						runId: params[1] as string,
						sessionUuid: (params[2] as string | null) ?? null,
						scope: params[3] as string,
						kind: params[4] as string,
						sequence: params[5] as number,
						status: params[6] as string,
						modelKey: params[7] as string | null,
						payload: JSON.parse(params[8] as string) as Record<string, unknown>,
					});
					return { rowCount: 1 };
				}
				if (sql.includes("MAX(sequence_number)")) return { rows: [{ max_sequence: this.seededSequence }] };
				if (sql.includes("DELETE FROM playground_run_events WHERE id IN")) return { rowCount: 0 };
				if (sql.includes("ORDER BY sequence_number ASC")) {
					assert.match(sql, /account_id = \$1 AND run_id = \$2 AND sequence_number > \$4/);
					const [accountId, runId, limit, after] = params as [number, string, number, number];
					this.replayArgs = { accountId, runId, limit, after };
					return { rows: this.inserts.filter(row => row.accountId === accountId && row.runId === runId && row.sequence > after)
						.sort((a, b) => a.sequence - b.sequence).slice(0, limit).map(row => ({ run_id: row.runId, sequence_number: row.sequence, kind: row.kind, status: row.status, payload: row.payload, version: 1 })) };
				}
				if (sql.startsWith("DELETE FROM playground_run_events WHERE account_id")) return { rowCount: this.purged };
				throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
			},
			release: () => {},
		};
	}
}

const recorder = (pool: FakePool) => new PlaygroundRunEventsService({ getPool: () => pool } as unknown as DatabaseService);

/**
 * The recorder is fire-and-forget by contract, so a test that asserts what it stored has to
 * let the writer's pending microtasks finish first. One macrotask boundary is enough: the
 * fake pool resolves on microtasks alone, so nothing is left pending after this.
 */
const drain = () => new Promise<void>(resolve => setImmediate(resolve));

test("payloads are clamped, flagged, and never carry non-data", () => {
	// The explicit view mirrors what a replay reader may rely on: clamped text, honest
	// truncation flags, and no field for whatever a caller smuggled in.
	const sanitized = sanitizeEventPayload({
		summary: "x".repeat(MAX_EVENT_TEXT + 40),
		count: 7,
		fraction: Number.NaN,
		ok: true,
		items: ["a".repeat(MAX_EVENT_TEXT + 1), 12, () => "drop me", 44],
		location: "/workspace",
		when: new Date("2026-10-23"),
		deep: { inner: "y".repeat(MAX_EVENT_TEXT + 1), deeper: { more: "dropped" } },
	}) as {
		summary?: string; summaryTruncated?: boolean; count?: number; ok?: boolean;
		items?: Array<string | number>; itemsTruncated?: boolean; location?: string;
		deep?: { inner?: string; innerTruncated?: boolean; deeper?: unknown };
	};
	assert.equal(sanitized.summary?.length, MAX_EVENT_TEXT);
	assert.equal(sanitized.summaryTruncated, true);
	assert.equal(sanitized.count, 7);
	assert.equal("fraction" in sanitized, false);
	assert.equal(sanitized.ok, true);
	assert.deepEqual(sanitized.items?.[0], "a".repeat(MAX_EVENT_TEXT));
	assert.equal(sanitized.items?.[1], 12);
	assert.equal(sanitized.items?.[2], 44);
	assert.equal(sanitized.itemsTruncated, true);
	assert.equal(sanitized.location, "/workspace");
	assert.equal("when" in sanitized, false);
	assert.equal(sanitized.deep?.inner?.length, MAX_EVENT_TEXT);
	assert.equal(sanitized.deep?.innerTruncated, true);
	assert.equal(sanitized.deep?.deeper, undefined);
});

test("run and session identifiers are validated, not trusted", () => {
	assert.equal(normalizeRunId("dsk-0123456789abcdef01234567"), "dsk-0123456789abcdef01234567");
	assert.equal(normalizeRunId("exec-0123456789abcdef01234567"), "exec-0123456789abcdef01234567");
	const uuid = "00000000-0000-4000-8000-000000000000";
	assert.equal(normalizeRunId(`  ${uuid} `), uuid);
	assert.equal(normalizeRunId("dsk"), null);
	assert.equal(normalizeRunId("dsk-NOPE"), null);
	assert.equal(normalizeRunId(42), null);
	assert.equal(normalizeSessionUuid("44444444-4444-4444-8444-444444444444".toUpperCase()), "44444444-4444-4444-8444-444444444444");
	assert.equal(normalizeSessionUuid("00000000-0000-5000-8000-000000000000"), null);
	assert.equal(normalizeSessionUuid("not-a-uuid"), null);
});

test("a run opens sequence 0 and advances between frames", async () => {
	const pool = new FakePool();
	const events = recorder(pool);
	await events.record(42, "dsk-0123456789abcdef01234567", "generation.started", { payload: { model: "lfm2_5_230m_q4_k_m" } });
	await events.record(42, "dsk-0123456789abcdef01234567", "generation.finished", {});
	assert.deepEqual(pool.inserts.map(row => row.sequence), [0, 1]);
	assert.equal(pool.inserts[0].runId.startsWith("dsk-"), true);
	assert.equal(pool.inserts[0].status, "pending");
	assert.equal(pool.inserts[1].status, "complete");
});

test("unknown kinds, unknown run shapes and seizures of the write path never insert", async () => {
	const pool = new FakePool();
	const events = recorder(pool);
	await events.record(42, "dsk-0123456789abcdef01234567", "basis.missing" as never, {});
	await events.record(42, "not-a-shape", "generation.finished", {});
	await events.record(42, "dsk-0123456789abcdef01234567", "generation.finished", {});
	await events.record(0, "dsk-0123456789abcdef01234567", "generation.finished", {});
	pool.insertShouldFail = true;
	await events.record(42, "dsk-0123456789abcdef01234567", "generation.finished", {});
	assert.equal(pool.inserts.length, 1);
});

test("bounded logs drop frames past the cap and mark it exactly once", async () => {
	const pool = new FakePool();
	const events = recorder(pool);
	for (let index = 0; index < MAX_EVENTS_PER_RUN; index += 1) {
		await events.record(42, "exec-0123456789abcdef01234567", "execution.output", { payload: { text: `frame-${index}` } });
	}
	assert.equal(pool.inserts.length, MAX_EVENTS_PER_RUN);
	await events.record(42, "exec-0123456789abcdef01234567", "execution.output", { payload: { text: "spillover" } });
	await events.record(42, "exec-0123456789abcdef01234567", "execution.output", { payload: { text: "spillover two" } });
	const markers = pool.inserts.filter(row => row.kind === "run.truncated");
	assert.equal(markers.length, 1);
	assert.equal(markers[0].payload.omitted, "execution.output");
	await events.record(42, "exec-0123456789abcdef01234567", "execution.finished", { payload: { exit_code: 0 } });
	assert.equal(pool.inserts.at(-1)?.kind, "execution.finished");
	// Completion after the output cap must remain reachable, not silently hidden behind
	// the first 400 stored rows. Gaps in dropped-output sequence numbers are legitimate.
	const first = await events.replay(42, "exec-0123456789abcdef01234567", 400) as { events: unknown[]; hasMore: boolean; nextAfterSequence: number };
	assert.equal(first.events.length, 400);
	assert.equal(first.hasMore, true);
	assert.equal(first.nextAfterSequence, 399);
	const next = await events.replay(42, "exec-0123456789abcdef01234567", 400, first.nextAfterSequence) as { events: Array<{ kind: string }>; hasMore: boolean; nextAfterSequence: number | null };
	assert.deepEqual(next.events.map(row => row.kind), ["run.truncated", "execution.finished"]);
	assert.equal(next.hasMore, false);
	assert.equal(next.nextAfterSequence, null);
	const otherAccount = await events.replay(99, "exec-0123456789abcdef01234567", 400, 399) as { events: unknown[] };
	assert.deepEqual(otherAccount.events, []);
});

test("replay is account-scoped and its limit is clamped", async () => {
	const pool = new FakePool();
	const events = recorder(pool);
	await events.replay(42, "dsk-0123456789abcdef01234567", 5000);
	assert.equal(pool.replayArgs?.accountId, 42);
	assert.equal(pool.replayArgs?.limit, MAX_EVENTS_PER_RUN + 1); // One look-ahead row, never more than 400 returned.
	// An id that fails validation returns an empty replay without touching the pool at
	// all -- there is no query to race and no shape to guess with.
	const refused = await events.replay(42, "../dsk-evil", 100) as { events: unknown[] };
	assert.deepEqual(refused.events, []);
	assert.equal(pool.replayArgs?.limit, MAX_EVENTS_PER_RUN + 1);
	await events.purgeAccountEvents(42);
	pool.purged = 3;
	await events.purgeSessionEvents(42, "00000000-0000-4000-8000-000000000000");
	assert.equal(pool.purged, 3);
});

class Reply extends EventEmitter {
	body = "";
	finished = false;
	destroyed = false;
	headersSent = false;
	status() { return this; }
	setHeader() { return this; }
	set() { return this; }
	flushHeaders() { this.headersSent = true; }
	write(value: string | Buffer) { this.body += String(value); return true; }
	override once(): this { return this; }
	override off(): this { return this; }
	end() { this.finished = true; }
}

type RecordedCall = { method: string; url: string; body?: string };

function sseResponse(frames: unknown[], calls: RecordedCall[] = [], status = 200) {
	return async (url: string | undefined, init?: { method?: string; body?: string }) => {
		calls.push({ method: init?.method || "GET", url: String(url), body: init?.body });
		if (status >= 400) return Response.json({ error: "UPSTREAM_TEST" }, { status });
		return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(""), { status, headers: { "Content-Type": "text/event-stream" } });
	};
}

/**
 * One recorded run end to end, in the same order the frames arrive: started, compaction,
 * both settlements, one finish. The second done frame the meter must ignore is included
 * because durability must not turn a duplicated frame into a duplicated row claim.
 */
test("one generation stream becomes one ordered, session-linked run", async () => {
	const previousFetch = globalThis.fetch;
	const pool = new FakePool();
	const calls: RecordedCall[] = [];
	globalThis.fetch = sseResponse([
		{ context: { compacted: true, inputLimit: 16384, tokensBefore: 9000, tokensAfter: 4200, summary: "keep constraints", usage: { prompt_tokens: 2200, completion_tokens: 140 } } },
		{ delta: "answer" },
		{ done: true, usage: { prompt_tokens: 800, completion_tokens: 60 } },
		{ done: true, usage: { prompt_tokens: 800, completion_tokens: 60 } },
	], calls) as unknown as typeof fetch;
	try {
		const billing = {
			getBalance: async () => ({ canGenerate: true }),
			getAllowance: async () => ({ remainingRon: 100 }),
			recordUsage: async () => {},
		} as unknown as BillingService;
		const addons = { resolveSpectreAccess: async () => ({ hasAccess: true, source: "tier" }) } as unknown as AddonsService;
		const service = new DesktopGatewayService(billing, addons, recorder(pool));
		const res = new Reply() as unknown as ExpressResponse;
		const result = await service.streamChat(res, 7, "max", {
			model: "lfm2_5_230m_q4_k_m",
			message: "continue",
			compaction_mode: "aggressive",
			session_uuid: "44444444-4444-4444-8444-444444444444",
		}, "playground");
		assert.equal(result.kind, "sent");
		assert.match(result.requestId, /^dsk-[0-9a-f]{24}$/);
		// The writes are fire-and-forget; let them land before reading the ledger.
		await drain();
		const kinds = pool.inserts.filter(row => row.runId === result.requestId).map(row => row.kind);
		assert.deepEqual(kinds, ["generation.started", "context.compacted", "settlement.succeeded", "generation.finished", "settlement.succeeded"]);
		const started = pool.inserts[0];
		assert.equal(started.accountId, 7);
		assert.equal(started.sessionUuid, "44444444-4444-4444-8444-444444444444");
		assert.equal(started.payload.compaction_mode, "aggressive");
		assert.equal(pool.inserts[1].payload.tokens_after, 4200);
		assert.equal(pool.inserts[1].payload.compacted, true);
		assert.equal(pool.inserts[3].status, "complete");
	} finally { globalThis.fetch = previousFetch; }
});

test("a run refused upstream still has its start and its reason", async () => {
	const previousFetch = globalThis.fetch;
	const pool = new FakePool();
	const calls: RecordedCall[] = [];
	globalThis.fetch = sseResponse([], calls, 502) as unknown as typeof fetch;
	try {
		const billing = { getBalance: async () => ({ canGenerate: true }), getAllowance: async () => ({ remainingRon: 100 }), recordUsage: async () => {} } as unknown as BillingService;
		const addons = { resolveSpectreAccess: async () => ({ hasAccess: true, source: "tier" }) } as unknown as AddonsService;
		const service = new DesktopGatewayService(billing, addons, recorder(pool));
		const result = await service.streamChat(new Reply() as unknown as ExpressResponse, 7, "max", { model: "lfm2_5_230m_q4_k_m", message: "hello" }, "playground");
		assert.equal(result.kind, "refused");
		// A refusal carries no request id back to the client by design; the fresh pool has
		// exactly one run in it, so the rows belong to it. The writes are fire-and-forget,
		// so let them land before reading the ledger.
		await drain();
		assert.deepEqual(pool.inserts.map(row => row.kind), ["generation.started", "generation.refused"]);
		assert.equal(pool.inserts[1].payload.status, 502);
	} finally { globalThis.fetch = previousFetch; }
});

test("a compaction that spent tokens and failed to fit still settles that work", async () => {
	const previousFetch = globalThis.fetch;
	const pool = new FakePool();
	try {
		globalThis.fetch = async () => Response.json({ error: "INPUT_CONTEXT_EXCEEDED", message: "History preserved", compaction_usage: { prompt_tokens: 2200, completion_tokens: 140 } }, { status: 413 }) as unknown as Response;
		const billing = { getBalance: async () => ({ canGenerate: true }), getAllowance: async () => ({ remainingRon: 100 }), recordUsage: async () => {} } as unknown as BillingService;
		const addons = { resolveSpectreAccess: async () => ({ hasAccess: true, source: "tier" }) } as unknown as AddonsService;
		const service = new DesktopGatewayService(billing, addons, recorder(pool));
		const result = await service.streamChat(new Reply() as unknown as ExpressResponse, 7, "max", { model: "lfm2_5_230m_q4_k_m", message: "hello" }, "playground");
		assert.equal(result.kind, "refused");
		// The compaction work happened upstream before the refusal was final, so its
		// settlement lands; the refused frame explains why no generation followed.
		await drain();
		assert.deepEqual(pool.inserts.map(row => row.kind), ["generation.started", "settlement.succeeded", "generation.refused"]);
	} finally { globalThis.fetch = previousFetch; }
});

test("one sandbox execution is one exec- stream from approval to finish", async () => {
	const previousFetch = globalThis.fetch;
	const previousUrl = process.env.PLAYGROUND_SANDBOX_URL;
	const previousKey = process.env.PLAYGROUND_SANDBOX_KEY;
	process.env.PLAYGROUND_SANDBOX_URL = "http://sandbox-test";
	process.env.PLAYGROUND_SANDBOX_KEY = "test-key-that-is-long-enough-1234567890";
	const pool = new FakePool();
	const calls: RecordedCall[] = [];
	globalThis.fetch = sseResponse([
		{ event: "execution.started", runId: "7c9e6679-742f-4bf0-8d3c-1d6fd5db0f30", location: "hosted-docker", cwd: "/workspace" },
		{ event: "execution.output", stream: "stdout", text: "hello" },
		{ event: "execution.finished", runId: "7c9e6679-742f-4bf0-8d3c-1d6fd5db0f30", exitCode: 0, stopped: false, seconds: 0.4 },
	], calls) as unknown as typeof fetch;
	try {
		const billing = { resolveTierFor: async () => "max" } as unknown as BillingService;
		const addons = { resolveSpectreAccess: async () => ({ hasAccess: true, source: "tier" }) } as unknown as AddonsService;
		const service = new PlaygroundSandboxService(billing, addons, recorder(pool));
		await service.run(9, "00000000-0000-4000-8000-000000000001", { command: "python3 main.py", approved: true, timeoutSeconds: 30 }, new Reply() as unknown as ExpressResponse);
		// The approval row is fire-and-forget; let it land before reading the ledger.
		await drain();
		const kinds = pool.inserts.map(row => row.kind);
		assert.deepEqual(kinds, ["execution.approved", "execution.started", "execution.output", "execution.finished"]);
		const runIds = new Set(pool.inserts.map(row => row.runId));
		assert.equal(runIds.size, 1);
		const runId = [...runIds][0];
		assert.match(runId, /^exec-[0-9a-f]{24}$/);
		assert.equal(pool.inserts[0].payload.command, "python3 main.py");
		assert.equal(pool.inserts[0].payload.sandbox_id, "00000000-0000-4000-8000-000000000001");
		assert.equal(pool.inserts[1].payload.broker_run_id, "7c9e6679-742f-4bf0-8d3c-1d6fd5db0f30");
		assert.equal(pool.inserts[3].payload.exit_code, 0);
		assert.ok(calls[0].url.endsWith(`/sandboxes/00000000-0000-4000-8000-000000000001/run`));
	} finally {
		globalThis.fetch = previousFetch;
		if (previousUrl === undefined) delete process.env.PLAYGROUND_SANDBOX_URL; else process.env.PLAYGROUND_SANDBOX_URL = previousUrl;
		if (previousKey === undefined) delete process.env.PLAYGROUND_SANDBOX_KEY; else process.env.PLAYGROUND_SANDBOX_KEY = previousKey;
	}
});

test("the allowlist stays closed-form: no caller's string reaches a row", () => {
	assert.equal(RUN_EVENT_KIND_SET.has("generation.started"), true);
	assert.equal(RUN_EVENT_KIND_SET.has("workspace.created"), true);
	assert.equal(RUN_EVENT_KIND_SET.has("anything.else"), false);
});
