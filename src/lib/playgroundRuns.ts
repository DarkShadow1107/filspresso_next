/** Read-only access to recorded activity. These endpoints never resume or execute a run. */
export type RecordedRun = {
	runId: string;
	sessionUuid: string | null;
	model: string;
	scope: string;
	updatedAt: string;
	eventCount: number;
	outcome: "pending" | "complete" | "failed";
	truncated: boolean;
	settlementFailed: boolean;
};
export type RecordedRunEvent = {
	runId: string;
	sequence: number;
	version: number;
	kind: string;
	status: string;
	createdAt: string;
	payload: unknown;
};
export type RunReplayPage = { events: RecordedRunEvent[]; hasMore: boolean; nextAfterSequence: number | null };

const RUN_ID = /^(?:dsk-[0-9a-f]{24}|exec-[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAGE_SIZE = 100;
const DISPLAY_LIMIT = 16_384;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function isRecordedRunId(value: unknown): value is string { return typeof value === "string" && RUN_ID.test(value); }

async function read(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const timeout = AbortSignal.timeout(8_000);
	const response = await fetch(url, { method: "GET", cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
	if (!response.ok) throw new Error(response.status === 401 ? "Sign in to view recorded activity." : "Recorded activity is unavailable. Please retry.");
	const body: unknown = await response.json();
	if (!record(body) || body.version !== 1) throw new Error("This activity format is not supported. Please update the client.");
	return body;
}

export async function listRecordedRuns(sessionUuid?: string, signal?: AbortSignal): Promise<RecordedRun[]> {
	if (sessionUuid !== undefined && !SESSION_ID.test(sessionUuid)) throw new Error("Invalid saved conversation id.");
	const query = new URLSearchParams({ limit: "20", ...(sessionUuid ? { sessionUuid } : {}) });
	const body = await read(`/api/playground/runs?${query}`, signal);
	if (!Array.isArray(body.runs)) throw new Error("The server returned an invalid activity list.");
	return body.runs.slice(0, 50).filter(record).filter(row => isRecordedRunId(row.run_id)).map(row => ({
		runId: row.run_id as string,
		sessionUuid: typeof row.session_uuid === "string" && SESSION_ID.test(row.session_uuid) ? row.session_uuid : null,
		model: typeof row.model_key === "string" ? row.model_key : "",
		scope: typeof row.scope === "string" ? row.scope : "",
		updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
		eventCount: Number.isInteger(Number(row.event_count)) && Number(row.event_count) >= 0 ? Number(row.event_count) : 0,
		outcome: row.outcome === "complete" || row.outcome === "failed" ? row.outcome : "pending",
		truncated: row.truncated === true,
		settlementFailed: row.settlement_failed === true,
	}));
}

export async function replayRecordedRun(runId: string, afterSequence = -1, signal?: AbortSignal): Promise<RunReplayPage> {
	if (!isRecordedRunId(runId) || !Number.isInteger(afterSequence) || afterSequence < -1 || afterSequence > 2_147_483_647) throw new Error("Invalid recorded activity id or cursor.");
	const body = await read(`/api/playground/runs/${runId}?${new URLSearchParams({ limit: String(PAGE_SIZE), afterSequence: String(afterSequence) })}`, signal);
	if (body.runId !== runId || !Array.isArray(body.events) || body.events.length > PAGE_SIZE || typeof body.hasMore !== "boolean") throw new Error("The server returned an invalid replay.");
	const events: RecordedRunEvent[] = [];
	let last = afterSequence;
	for (const row of body.events) {
		if (!record(row) || row.run_id !== runId || !Number.isInteger(row.sequence_number) || Number(row.sequence_number) <= last ||
			!Number.isInteger(row.version) || Number(row.version) < 1 || typeof row.kind !== "string") throw new Error("The server returned an invalid replay event.");
		last = Number(row.sequence_number);
		events.push({ runId, sequence: last, version: Number(row.version), kind: row.kind, status: typeof row.status === "string" ? row.status : "unknown",
			createdAt: typeof row.created_at === "string" ? row.created_at : "", payload: row.payload ?? null });
	}
	const hasMore = body.hasMore === true;
	if (hasMore && (!events.length || body.nextAfterSequence !== last)) throw new Error("The server returned an invalid replay cursor.");
	return { events, hasMore, nextAfterSequence: hasMore ? last : null };
}

export function recordedRunLabel(runId: string): string {
	return runId.startsWith("dsk-") ? "Generation" : runId.startsWith("exec-") ? "Hosted execution / workspace" : "Workspace activity";
}
export function recordedRunOutcome(outcome: RecordedRun["outcome"]): string {
	return outcome === "complete" ? "Completion recorded" : outcome === "failed" ? "Failure recorded" : "No completion recorded";
}
export function recordedRunLocation(runId: string): string {
	return runId.startsWith("dsk-") ? "Model: hosted AI · Chat did not execute code." : "Code boundary: hosted Docker sandbox · No local command is being run.";
}

export function replayPayloadDisplay(payload: unknown): { text: string; clipped: boolean } {
	const text = JSON.stringify(payload ?? null, null, 2) ?? "(no payload recorded)";
	const flagged = (value: unknown, depth = 0): boolean => depth <= 2 && record(value) && Object.entries(value).some(([key, item]) => (key.endsWith("Truncated") && item === true) || flagged(item, depth + 1));
	return { text: text.length > DISPLAY_LIMIT ? `${text.slice(0, DISPLAY_LIMIT)}\n[Display clipped; this is not the full payload.]` : text, clipped: text.length > DISPLAY_LIMIT || flagged(payload) };
}
