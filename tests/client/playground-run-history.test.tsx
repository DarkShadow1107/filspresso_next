import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordedEventCard } from "../../src/components/playground/PlaygroundRunHistory";
import { listRecordedRuns, recordedRunLocation, recordedRunOutcome, replayPayloadDisplay, replayRecordedRun, type RecordedRunEvent } from "../../src/lib/playgroundRuns";

const runId = "exec-0123456789abcdef01234567";
const session = "00000000-0000-4000-8000-000000000001";
const row = (sequence: number, kind = "execution.output", version = 1) => ({ run_id: runId, sequence_number: sequence, kind, version, payload: { text: "output" }, status: "pending", created_at: "2026-10-24T02:00:00Z" });

test("activity discovery sends only no-store GETs and preserves explicit session filtering", async t => {
	const urls: string[] = [];
	t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
		urls.push(url);
		assert.equal(options.method, "GET");
		assert.equal(options.cache, "no-store");
		assert.equal(options.body, undefined);
		return Response.json({ version: 1, runs: [{ run_id: runId, session_uuid: session, event_count: 402, outcome: "pending", truncated: true, settlement_failed: true }, { run_id: "../bad" }] });
	});
	const runs = await listRecordedRuns();
	assert.equal(runs.length, 1);
	assert.equal(runs[0].eventCount, 402);
	assert.equal(runs[0].truncated, true);
	assert.equal(runs[0].settlementFailed, true);
	assert.equal(recordedRunOutcome(runs[0].outcome), "No completion recorded");
	await listRecordedRuns(session);
	assert.equal(urls[0], "/api/playground/runs?limit=20");
	assert.equal(urls[1], `/api/playground/runs?limit=20&sessionUuid=${session}`);
});

test("event cursors cross omitted-output gaps and reach completion beyond the first page", async t => {
	t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
		assert.equal(options.method, "GET");
		assert.equal(options.body, undefined);
		const after = Number(new URL(url, "https://example.test").searchParams.get("afterSequence"));
		return after === -1
			? Response.json({ version: 1, runId, events: [row(399), row(400, "run.truncated")], hasMore: true, nextAfterSequence: 400 })
			: Response.json({ version: 1, runId, events: [row(900, "execution.finished"), row(901, "settlement.failed")], hasMore: false, nextAfterSequence: null });
	});
	const first = await replayRecordedRun(runId);
	assert.equal(first.hasMore, true);
	const next = await replayRecordedRun(runId, first.nextAfterSequence!);
	assert.deepEqual(next.events.map(event => event.kind), ["execution.finished", "settlement.failed"]);
	assert.equal(next.hasMore, false);
	assert.equal(next.nextAfterSequence, null);
});

test("invalid ids, filters and cursors never issue requests or widen to account history", async t => {
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected request"); });
	await assert.rejects(listRecordedRuns(""), /Invalid/);
	await assert.rejects(listRecordedRuns("../all"), /Invalid/);
	await assert.rejects(replayRecordedRun("../all"), /Invalid/);
	await assert.rejects(replayRecordedRun(runId, -2), /Invalid/);
	await assert.rejects(replayRecordedRun(runId, 2_147_483_648), /Invalid/);
	assert.equal(calls, 0);
});

test("missing, duplicated, unordered, oversized and cross-run pages are rejected", async t => {
	let payload: unknown;
	t.mock.method(globalThis, "fetch", async () => Response.json(payload));
	for (const events of [[row(1), row(1)], [row(2), row(1)], [{ ...row(1), run_id: `dsk-${"a".repeat(24)}` }], Array.from({ length: 101 }, (_, i) => row(i))]) {
		payload = { version: 1, runId, events, hasMore: false };
		await assert.rejects(replayRecordedRun(runId), /invalid replay/i);
	}
	payload = { version: 1, runId, events: [row(1)], hasMore: true, nextAfterSequence: 0 };
	await assert.rejects(replayRecordedRun(runId), /cursor/);
	payload = { version: 1, runId, events: [] }; // Older servers must not silently hide a terminal page.
	await assert.rejects(replayRecordedRun(runId), /invalid replay/i);
});

test("unknown envelopes fail visibly; unknown event versions remain inert data", async t => {
	let payload: unknown = { version: 2, runs: [] };
	t.mock.method(globalThis, "fetch", async () => Response.json(payload));
	await assert.rejects(listRecordedRuns(), /not supported/);
	payload = { version: 1, runId, events: [{ ...row(0, "future.command", 2), payload: ["future array data"] }], hasMore: false };
	const page = await replayRecordedRun(runId);
	const html = renderToStaticMarkup(<RecordedEventCard event={page.events[0]} />);
	assert.match(html, /Unknown event version; shown as data only/);
	assert.match(html, /future array data/);
	assert.doesNotMatch(html, /<button/);
});

test("payload rendering escapes HTML, discloses truncation and never offers execution", () => {
	const event: RecordedRunEvent = { runId, sequence: 400, version: 1, kind: "run.truncated", status: "complete", createdAt: "", payload: { command: "<script>alert('do not execute')</script>", textTruncated: true } };
	const html = renderToStaticMarkup(<RecordedEventCard event={event} />);
	assert.doesNotMatch(html, /<script|<button/);
	assert.match(html, /&lt;script&gt;/);
	assert.match(html, /not a complete log/);
	assert.equal(replayPayloadDisplay({ nested: { textTruncated: true } }).clipped, true);
	const display = replayPayloadDisplay({ text: "x".repeat(50_000) });
	assert.equal(display.clipped, true);
	assert.ok(display.text.length < 17_000);
	assert.match(display.text, /Display clipped/);
	assert.match(recordedRunLocation(`dsk-${"a".repeat(24)}`), /Chat did not execute code/);
	assert.match(recordedRunLocation(runId), /hosted Docker/);
});

test("unavailable activity is an error, not a fabricated empty history; cancellation propagates", async t => {
	let response = Response.json({}, { status: 503 });
	t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => { options.signal?.throwIfAborted(); return response; });
	await assert.rejects(listRecordedRuns(), /unavailable/);
	response = Response.json({}, { status: 401 });
	await assert.rejects(listRecordedRuns(), /Sign in/);
	const controller = new AbortController(); controller.abort();
	await assert.rejects(replayRecordedRun(runId, -1, controller.signal), error => error instanceof Error && error.name === "AbortError");
});
