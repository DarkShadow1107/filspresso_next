import "./test-env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA, HEADERS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard";
import type { DatabaseService } from "../src/database/database.service";
import { MAX_RUNS_PER_LIST, PlaygroundRunEventsService } from "../src/desktop/playground-run-events.service";
import { PlaygroundSessionsController } from "../src/desktop/playground-sessions.controller";
import type { PlaygroundSessionsService } from "../src/desktop/playground-sessions.service";

const session = "00000000-0000-4000-8000-000000000001";
const runId = "exec-0123456789abcdef01234567";

test("run discovery is bounded, account-scoped metadata and never returns event payloads", async () => {
	const queries: Array<{ sql: string; params: unknown[] }> = [];
	let released = 0;
	const events = new PlaygroundRunEventsService({ getPool: () => ({ connect: async () => ({
		query: async (sql: string, params: unknown[]) => {
			queries.push({ sql, params });
			assert.match(sql, /WHERE account_id = \$1/);
			assert.doesNotMatch(sql, /\bpayload\b/);
			assert.match(sql, /ORDER BY MAX\(created_at\) DESC, run_id ASC LIMIT \$2/);
			assert.match(sql, /version = 1 AND kind IN \('generation.finished', 'execution.finished'/);
			assert.match(sql, /settlement_failed/); // Billing outcome stays distinct from work completion.
			return { rows: [{ run_id: runId, outcome: "pending", settlement_failed: true }] };
		}, release: () => released++,
	}) }) } as unknown as DatabaseService);
	assert.deepEqual(await events.list(42, 9999), { version: 1, runs: [{ run_id: runId, outcome: "pending", settlement_failed: true }] });
	assert.deepEqual(queries[0].params, [42, MAX_RUNS_PER_LIST]);
	assert.doesNotMatch(queries[0].sql, /session_uuid = \$3/);
	await events.list(42, 0, session);
	assert.deepEqual(queries[1].params, [42, 1, session]);
	assert.match(queries[1].sql, /AND session_uuid = \$3/);
	await events.list(42, Number.NaN);
	assert.deepEqual(queries[2].params, [42, 20]);
	assert.equal(released, 3);
	assert.deepEqual(await events.list(0), { version: 1, runs: [] });
	assert.deepEqual(await events.list(42, 20, "invalid"), { version: 1, runs: [] });
	assert.equal(queries.length, 3); // Invalid filters must not fall back to the account-wide view.
});

test("discovery and replay remain JWT guarded and validate filters/cursors before querying", () => {
	assert.ok(Reflect.getMetadata(GUARDS_METADATA, PlaygroundSessionsController).includes(JwtAuthGuard));
	for (const method of [PlaygroundSessionsController.prototype.listRuns, PlaygroundSessionsController.prototype.replay]) {
		assert.deepEqual(Reflect.getMetadata(HEADERS_METADATA, method), [{ name: "Cache-Control", value: "no-store" }]);
	}
	const controller = new PlaygroundSessionsController({} as PlaygroundSessionsService, {} as PlaygroundRunEventsService);
	const req = { user: { id: 42 } };
	for (const filter of ["", "../other", session.replace("4000", "1000")]) assert.throws(() => controller.listRuns(req, "20", filter), BadRequestException);
	for (const cursor of ["-2", "NaN", "1.5", "2147483648", "", "1 OR 1=1"]) assert.throws(() => controller.replay(req, runId, "100", cursor), BadRequestException);
	assert.throws(() => controller.listRuns({ user: { id: 0 } }), BadRequestException);
});

test("read failures release the connection and propagate rather than fabricating empty history", async () => {
	let released = 0;
	const events = new PlaygroundRunEventsService({ getPool: () => ({ connect: async () => ({
		query: async () => { throw new Error("synthetic read failure"); }, release: () => released++,
	}) }) } as unknown as DatabaseService);
	await assert.rejects(events.list(42), /synthetic read failure/);
	await assert.rejects(events.replay(42, runId), /synthetic read failure/);
	assert.equal(released, 2);
});
