"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PlaygroundRunEventsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaygroundRunEventsService = exports.MAX_RUNS_PER_LIST = exports.MAX_EVENTS_PER_RUN = exports.MAX_PAYLOAD_ITEMS = exports.MAX_PAYLOAD_FIELDS = exports.MAX_EVENT_TEXT = exports.TERMINAL_RUN_EVENTS = exports.RUN_EVENT_STATUSES = exports.RUN_EVENT_KIND_SET = exports.RUN_EVENT_KINDS = exports.RUN_EVENT_VERSION = void 0;
exports.normalizeRunId = normalizeRunId;
exports.normalizeSessionUuid = normalizeSessionUuid;
exports.sanitizeEventPayload = sanitizeEventPayload;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
/**
 * The server-owned record of what a generation or a hosted execution did, in order.
 *
 * Billing answers "was this account charged?"; this answers "what happened at that run" --
 * the question nobody could answer before, because the compaction checkpoint lived only in
 * the browser's localStorage and a sandbox run that outlived its tab left nothing behind.
 * It is one reason `execution.started` rows exist even though the outcome is what the user
 * actually cares about: the `pending` status on a run whose terminal event never arrived is
 * itself a finding, not a gap.
 *
 * ## Fail-open, always
 *
 * Recording shares the settleCompaction rule: a lost event is an observability problem; an
 * interrupted generation or execution is a lost customer answer. Nothing in record() ever
 * throws into a stream path -- every failure becomes a warning log and the run carries on.
 *
 * ## Bounded by construction
 *
 * Payloads are saturated through sanitizeEventPayload, ordinary output is capped at
 * MAX_EVENTS_PER_RUN rows (output frames beyond the cap are dropped and a single
 * `run.truncated` marker says so -- "bounded logs" means the log itself says where it was
 * cut; essential completion/settlement events survive the cap), and the hourly sweep
 * deletes rows older than the retention window in bounded batches. None of these bounds
 * are enforced by hoping the callers are polite.
 */
exports.RUN_EVENT_VERSION = 1;
/**
 * Every kind the recorder accepts, in one allowlist.
 *
 * A closed set rather than free-form text because replay is written on purpose: a kind a
 * client can branch on today must keep meaning the same thing tomorrow. New kinds are an
 * edit here plus the service's own validation -- never a caller's string choice. The
 * database has no CHECK for the same reason; a CHECK that drifts from this list would
 * silently drop rows with nobody the wiser.
 */
exports.RUN_EVENT_KINDS = [
    // Generations
    "generation.started",
    "generation.refused",
    "generation.finished",
    // A verified native MODEL proposal, not evidence of approval or tool execution.
    "tool.proposed",
    "tool.approval",
    "tool.declined",
    "tool.started",
    "tool.finished",
    "tool.failed",
    // Compaction
    "context.compacted",
    // Settlement (the billing outcome, distinct from the work: a finished generation whose
    // charge failed is only diagnosable if both facts are recorded separately)
    "settlement.succeeded",
    "settlement.failed",
    // Hosted sandbox execution
    "execution.approved",
    "execution.started",
    "execution.output",
    "execution.finished",
    "execution.failed",
    // Workspaces
    "workspace.created",
    "workspace.discarded",
    // Bookkeeping
    "run.truncated",
];
exports.RUN_EVENT_KIND_SET = new Set(exports.RUN_EVENT_KINDS);
exports.RUN_EVENT_STATUSES = ["pending", "complete", "failed"];
/** Kinds that must be recorded even after a run has hit the per-run cap. */
exports.TERMINAL_RUN_EVENTS = new Set([
    "tool.declined",
    "tool.finished",
    "tool.failed",
    "generation.refused",
    "generation.finished",
    "context.compacted",
    "settlement.succeeded",
    "settlement.failed",
    "execution.finished",
    "execution.failed",
    "workspace.discarded",
    "run.truncated",
]);
/** One recorded event text field. A compaction summary is the largest legitimate payload. */
exports.MAX_EVENT_TEXT = 4096;
exports.MAX_PAYLOAD_FIELDS = 24;
exports.MAX_PAYLOAD_ITEMS = 8;
/**
 * The ordinary-output cap per run; essential terminal events may follow it. A chatty
 * command can emit thousands of output
 * frames; the durability value is in the approval, the outcome and the duration, not in
 * every 64 KiB stdout chunk.
 */
exports.MAX_EVENTS_PER_RUN = 400;
exports.MAX_RUNS_PER_LIST = 50;
/** Runs whose map entries linger forever would be a slow leak; the cap mirrors the broker's own _touched eviction. */
const MAX_TRACKED_RUNS = 1024;
const MAX_TRACKED_TRIM = 256;
const RUN_ID_PATTERN = /^(dsk-[0-9a-f]{24}|exec-[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
/** Same v4-only rule as the anonymous fingerprint: a validator that accepts any UUID shape is not validating. */
const SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/**
 * A run id the recorder will store. Three shapes, all server-minted: the gateway's
 * `dsk-` request ids, the sandbox service's `exec-` attempt ids, and the broker's own v4
 * uuids (defensive only -- those are recorded in payloads, not in this column).
 */
function normalizeRunId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return RUN_ID_PATTERN.test(trimmed) ? trimmed : null;
}
/** Lowercased and validated, or nothing. Anything else is a client typo, not a linkage. */
function normalizeSessionUuid(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim().toLowerCase();
    return SESSION_UUID_PATTERN.test(trimmed) ? trimmed : null;
}
/**
 * Turn an arbitrary payload into something small, flat and honest about clipping.
 *
 * Strings clamp with an explicit `<key>Truncated` flag -- a silent ellipsis would make a
 * replay lie about what was stored. Numbers must be finite; booleans survive; one nested
 * object level is flattened through the same rules; arrays keep their first items, clamped,
 * because first output frames carry headers/errors and the rest is filler. Functions,
 * symbols, cycles between levels and unknowns are dropped, not stringified: JSON.stringify
 * on the unsanitized would also pull in whatever the caller accidentally passed.
 */
function sanitizeEventPayload(value, depth = 0) {
    const result = {};
    // Dates and Boxes: neither round-trips as data, and stringifying whatever arrived by
    // accident would serialize the caller's mistake into the durable record.
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 1 || value instanceof Date)
        return result;
    const entries = Object.entries(value).slice(0, exports.MAX_PAYLOAD_FIELDS);
    for (const [key, raw] of entries) {
        if (!key || key.length > 64)
            continue;
        if (typeof raw === "string") {
            if (raw.length > exports.MAX_EVENT_TEXT) {
                result[key] = raw.slice(0, exports.MAX_EVENT_TEXT);
                result[`${key}Truncated`] = true;
            }
            else
                result[key] = raw;
        }
        else if (typeof raw === "number") {
            if (Number.isFinite(raw))
                result[key] = raw;
        }
        else if (typeof raw === "boolean") {
            result[key] = raw;
        }
        else if (Array.isArray(raw)) {
            const items = raw.slice(0, exports.MAX_PAYLOAD_ITEMS)
                .map(item => (typeof item === "string" ? item.slice(0, exports.MAX_EVENT_TEXT) : (typeof item === "number" && Number.isFinite(item) ? item : null)))
                .filter(item => item !== null);
            // Anything lost -- to the cap or to a non-scalar entry -- is flagged, so a replay
            // can never count an array that claims to be whole and quietly is not.
            if (items.length !== raw.length)
                result[`${key}Truncated`] = true;
            result[key] = items;
        }
        else if (raw && typeof raw === "object") {
            // An object that sanitizes to nothing -- a Date, a Boxed value, an empty map --
            // carries no data, so it is dropped rather than stored as a husk that could be
            // mistaken for a real payload field.
            const nested = sanitizeEventPayload(raw, depth + 1);
            if (Object.keys(nested).length)
                result[key] = nested;
        }
    }
    return result;
}
let PlaygroundRunEventsService = PlaygroundRunEventsService_1 = class PlaygroundRunEventsService {
    db;
    logger = new common_1.Logger(PlaygroundRunEventsService_1.name);
    /** Per-run sequence counters, seeded from the table the first time a run is seen after a restart. */
    sequences = new Map();
    truncatedRuns = new Set();
    lastSweepAt = 0;
    constructor(db) {
        this.db = db;
    }
    /**
     * Append one event. Never throws; a failed record is a warning and nothing more.
     *
     * `runId` and `kind` must pass their validators; an invalid combination is dropped here
     * rather than shouted about, because callers hand this values assembled from upstream
     * frames and the polite failure is to leave the ledger quiet, not to fail a request the
     * customer already got value from.
     */
    async record(accountId, runId, kind, options = {}) {
        try {
            const normalizedRun = normalizeRunId(runId);
            if (!normalizedRun || !Number.isInteger(accountId) || accountId <= 0)
                return;
            if (!exports.RUN_EVENT_KIND_SET.has(kind))
                return;
            const status = typeof options.status === "string" && exports.RUN_EVENT_STATUSES.includes(options.status)
                ? options.status
                : defaultStatus(kind);
            const payload = options.payload === undefined || options.payload === null ? {} : sanitizeEventPayload(options.payload);
            const sessionUuid = normalizeSessionUuid(options.sessionUuid);
            const modelKey = typeof options.modelKey === "string" && options.modelKey.length <= 64 ? options.modelKey : null;
            const scope = options.scope === "desktop" ? "desktop" : "playground";
            await this.maybeSweep();
            const sequence = await this.nextSequence(normalizedRun);
            if (sequence === null)
                return;
            // Cap bookkeeping up front: whether this event is stored as-is, skipped, or
            // replaced by a marker, the counter moves so the next frame gets the next number.
            if (this.sequences.size > MAX_TRACKED_RUNS)
                this.trimTracked();
            if (sequence >= exports.MAX_EVENTS_PER_RUN && !exports.TERMINAL_RUN_EVENTS.has(kind)) {
                if (!this.truncatedRuns.has(normalizedRun))
                    this.truncatedRuns.add(normalizedRun);
                else
                    return;
                await this.insert(accountId, normalizedRun, "run.truncated", sequence, "complete", {
                    payload: { omitted: kind },
                    sessionUuid, modelKey, scope,
                });
                return;
            }
            await this.insert(accountId, normalizedRun, kind, sequence, status, { payload, sessionUuid, modelKey, scope });
        }
        catch (err) {
            this.logger.warn(`run event record failed for ${runId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * Recent run metadata, newest first, account-scoped and optionally session-filtered.
     * Raw rows keep snake_case column names, like the sessions API. No payloads are listed.
     */
    async list(accountId, limit = 20, sessionUuid) {
        const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 20, 1), exports.MAX_RUNS_PER_LIST);
        const session = sessionUuid === undefined ? null : normalizeSessionUuid(sessionUuid);
        if (!Number.isInteger(accountId) || accountId <= 0 || (sessionUuid !== undefined && !session))
            return { version: exports.RUN_EVENT_VERSION, runs: [] };
        const client = await this.db.getPool().connect();
        try {
            // Metadata only. Unlinked runs (including a conversation's first generation and
            // hosted executions) remain discoverable through the account-wide view.
            const result = await client.query(`SELECT run_id, MAX(session_uuid::text) AS session_uuid, MAX(scope) AS scope,
				 MAX(model_key) AS model_key, MIN(created_at) AS started_at, MAX(created_at) AS updated_at,
				 COUNT(*)::int AS event_count,
				 CASE WHEN BOOL_OR(version = 1 AND kind IN ('generation.refused', 'execution.failed', 'tool.failed')) THEN 'failed'
				      WHEN BOOL_OR(version = 1 AND kind IN ('generation.finished', 'execution.finished', 'workspace.created', 'workspace.discarded', 'tool.finished', 'tool.declined')) THEN 'complete'
				      ELSE 'pending' END AS outcome,
				 BOOL_OR(kind = 'run.truncated') AS truncated,
				 BOOL_OR(version = 1 AND kind = 'settlement.failed') AS settlement_failed
				 FROM playground_run_events WHERE account_id = $1 ${session ? "AND session_uuid = $3" : ""}
				 GROUP BY run_id ORDER BY MAX(created_at) DESC, run_id ASC LIMIT $2`, session ? [accountId, safeLimit, session] : [accountId, safeLimit]);
            return { version: exports.RUN_EVENT_VERSION, runs: result.rows };
        }
        finally {
            client.release();
        }
    }
    /** Oldest-first event pages, including terminal facts that were recorded after the output cap. */
    async replay(accountId, runId, limit = 400, afterSequence = -1) {
        const normalizedRun = normalizeRunId(runId);
        if (!normalizedRun || !Number.isInteger(accountId) || accountId <= 0)
            return { runId, version: exports.RUN_EVENT_VERSION, events: [], hasMore: false, nextAfterSequence: null };
        const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 400, 1), exports.MAX_EVENTS_PER_RUN);
        const safeAfter = Number.isInteger(afterSequence) && afterSequence >= -1 && afterSequence <= 2_147_483_647 ? afterSequence : -1;
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query(`SELECT id, run_id, session_uuid, scope, kind, sequence_number, status, model_key, payload, version, created_at
				 FROM playground_run_events WHERE account_id = $1 AND run_id = $2 AND sequence_number > $4
				 ORDER BY sequence_number ASC, id ASC LIMIT $3`, [accountId, normalizedRun, safeLimit + 1, safeAfter]);
            const hasMore = result.rows.length > safeLimit;
            const events = result.rows.slice(0, safeLimit);
            return { runId: normalizedRun, version: exports.RUN_EVENT_VERSION, events, hasMore,
                nextAfterSequence: hasMore ? Number(events.at(-1)?.sequence_number) : null };
        }
        finally {
            client.release();
        }
    }
    /** Deletion control for one conversation's events. Counts, because the caller may need to say what happened. */
    async purgeSessionEvents(accountId, sessionUuid) {
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query("DELETE FROM playground_run_events WHERE account_id = $1 AND session_uuid = $2", [accountId, sessionUuid]);
            return result.rowCount ?? 0;
        }
        finally {
            client.release();
        }
    }
    /** Deletion control for the whole account. Also the honest answer to "erase my Playground activity". */
    async purgeAccountEvents(accountId) {
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query("DELETE FROM playground_run_events WHERE account_id = $1", [accountId]);
            return result.rowCount ?? 0;
        }
        finally {
            client.release();
        }
    }
    async insert(accountId, runId, kind, sequence, status, parts) {
        const client = await this.db.getPool().connect();
        try {
            // ON CONFLICT DO NOTHING is what makes a two-instance race idempotent rather than
            // a 500: the instance that loses the race simply does not store that frame.
            await client.query(`INSERT INTO playground_run_events (account_id, run_id, session_uuid, scope, kind, sequence_number, status, model_key, payload, version)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
				 ON CONFLICT (run_id, sequence_number) DO NOTHING`, [accountId, runId, parts.sessionUuid, parts.scope, kind, sequence, status, parts.modelKey, JSON.stringify(parts.payload), exports.RUN_EVENT_VERSION]);
        }
        finally {
            client.release();
        }
    }
    /**
     * The next sequence number for a run: the in-process counter when known, otherwise
     * seeded from the table. The seed query is one indexed MAX per new run -- a handful per
     * minute across all clients -- not per frame, because output frames land on the counter.
     */
    async nextSequence(runId) {
        const known = this.sequences.get(runId);
        if (known !== undefined) {
            this.sequences.set(runId, known + 1);
            return known;
        }
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query("SELECT COALESCE(MAX(sequence_number), -1) AS max_sequence FROM playground_run_events WHERE run_id = $1", [runId]);
            const seeded = Number(result.rows[0]?.max_sequence ?? -1) + 1;
            if (!Number.isFinite(seeded) || seeded < 0)
                return null;
            this.sequences.set(runId, seeded + 1);
            return seeded;
        }
        finally {
            client.release();
        }
    }
    trimTracked() {
        // Maps preserve insertion order, so the oldest runs are at the front. A dropped
        // counter only costs a re-seed on that run's next event; it cannot rewind one.
        for (const runId of [...this.sequences.keys()].slice(0, this.sequences.size - MAX_TRACKED_TRIM))
            this.sequences.delete(runId);
    }
    /**
     * Hourly, bounded: a limited subquery drives the DELETE, so one sweep removes at most a
     * small batch and no sweep ever serializes the table behind a giant statement.
     */
    async maybeSweep() {
        const now = Date.now();
        if (now - this.lastSweepAt < 60 * 60_000)
            return;
        this.lastSweepAt = now;
        const parsed = Number.parseInt(String(process.env.PLAYGROUND_RUN_EVENT_RETENTION_DAYS ?? ""), 10);
        const days = Number(parsed) >= 1 ? Math.min(parsed, 365) : 7;
        const client = await this.db.getPool().connect();
        try {
            await client.query(`DELETE FROM playground_run_events WHERE id IN (
					SELECT id FROM playground_run_events WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')
					ORDER BY created_at ASC LIMIT 500
				 )`, [days]);
        }
        catch (err) {
            this.logger.warn(`run event retention sweep failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            client.release();
        }
    }
};
exports.PlaygroundRunEventsService = PlaygroundRunEventsService;
exports.PlaygroundRunEventsService = PlaygroundRunEventsService = PlaygroundRunEventsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], PlaygroundRunEventsService);
/** Started/output frames are provisional until a terminal event lands for the same run. */
function defaultStatus(kind) {
    if (kind === "generation.started" || kind === "execution.started" || kind === "execution.output" || kind === "workspace.created")
        return "pending";
    if (kind === "generation.refused" || kind === "settlement.failed" || kind === "execution.failed")
        return "failed";
    return "complete";
}
