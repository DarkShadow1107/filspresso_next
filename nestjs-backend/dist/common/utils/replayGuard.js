"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeOperationId = normalizeOperationId;
exports.extractOperationId = extractOperationId;
exports.resolveActorId = resolveActorId;
exports.sweepExpiredReplayOperations = sweepExpiredReplayOperations;
exports.startReplaySweep = startReplaySweep;
exports.stopReplaySweep = stopReplaySweep;
exports.lastReplaySweepAt = lastReplaySweepAt;
exports.reserveReplayOperation = reserveReplayOperation;
const DEFAULT_REPLAY_TTL_SECONDS = Math.min(Math.max(Number.parseInt(process.env.OPERATION_REPLAY_TTL_SECONDS || "900", 10) || 900, 60), 86400);
const OPERATION_ID_PATTERN = /^[A-Za-z0-9:_-]{12,128}$/;
function normalizeOperationId(value) {
    const text = String(value || "").trim();
    if (!text)
        return "";
    if (!OPERATION_ID_PATTERN.test(text))
        return "";
    return text;
}
function extractOperationId(req) {
    const headerValue = String(req.headers["x-operation-id"] || req.headers["x-idempotency-key"] || "").trim();
    if (headerValue)
        return headerValue;
    const body = req.body && typeof req.body === "object" ? req.body : null;
    if (!body)
        return "";
    const fromBody = String(body.operation_id || body.operationId || "").trim();
    return fromBody;
}
function resolveActorId(req) {
    if (req.user?.id)
        return `user:${req.user.id}`;
    if (req.adminSession?.userId)
        return `admin:${req.adminSession.userId}`;
    if (req.serviceIdentity?.service_name)
        return `service:${String(req.serviceIdentity.service_name).slice(0, 64)}`;
    if (req.ip)
        return `ip:${String(req.ip).slice(0, 64)}`;
    return "anonymous";
}
/**
 * Expiry sweep.
 *
 * Phase 7.5: the DELETE ran on every single guarded request, so the hot path issued a
 * write proportional to nothing -- no index on `expires_at` made it a scan, and it
 * contended with the INSERT immediately after it. That is a table-wide write per request
 * to clean up rows nobody reads.
 *
 * Correctness does not need it per-request: a row is only ever *read* by the conflict
 * check, and an expired row that has not been swept yet cannot cause a false replay,
 * because a replay of the same operation id within the TTL is what we detect, and an id
 * older than its own TTL is by definition not in its replay window. So expiry is
 * housekeeping and belongs on a timer.
 *
 * Runs at most once per interval per process. Several app replicas therefore each sweep,
 * which is harmless -- the DELETE is idempotent and cheap once the index exists.
 */
const SWEEP_INTERVAL_MS = (() => {
    const parsed = Number.parseInt(String(process.env.OPERATION_REPLAY_SWEEP_INTERVAL_MS ?? ""), 10);
    return Number.isFinite(parsed) && parsed >= 5000 ? Math.min(parsed, 3600000) : 60000;
})();
let lastSweepAt = 0;
let sweepTimer = null;
/** Delete expired rows. Safe to call concurrently; the DELETE is idempotent. */
async function sweepExpiredReplayOperations(pool) {
    try {
        const result = await pool.query("DELETE FROM security_operation_replay_guard WHERE expires_at < NOW()");
        return Number(result.rowCount) || 0;
    }
    catch {
        // Housekeeping must never fail a request.
        return 0;
    }
}
/**
 * Start the background sweep, and sweep once immediately.
 *
 * Called from the module that owns the pool. `unref()` so the timer does not by itself
 * keep the process alive during shutdown.
 */
function startReplaySweep(pool) {
    if (sweepTimer)
        return;
    lastSweepAt = Date.now();
    void sweepExpiredReplayOperations(pool);
    sweepTimer = setInterval(() => {
        lastSweepAt = Date.now();
        void sweepExpiredReplayOperations(pool);
    }, SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();
}
/** Stop the background sweep. Test-only and shutdown paths. */
function stopReplaySweep() {
    if (sweepTimer)
        clearInterval(sweepTimer);
    sweepTimer = null;
}
/** When the last sweep ran, for tests and the health endpoint. */
function lastReplaySweepAt() {
    return lastSweepAt;
}
async function reserveReplayOperation(pool, options = {}) {
    const scope = String(options.scope || "global").trim().slice(0, 64) || "global";
    const actorId = String(options.actorId || "anonymous").trim().slice(0, 128) || "anonymous";
    const ttlSeconds = Math.min(Math.max(Number.parseInt(options.ttlSeconds || String(DEFAULT_REPLAY_TTL_SECONDS), 10) || DEFAULT_REPLAY_TTL_SECONDS, 60), 86400);
    const operationId = normalizeOperationId(options.operationId);
    if (!operationId)
        return { ok: false, reason: "invalid_operation_id" };
    // Expiry is handled by startReplaySweep on a timer. A cheap time check keeps the very
    // first request after a quiet period from waiting up to a full interval on a table
    // that has accumulated rows, without putting a write back on every request.
    if (Date.now() - lastSweepAt >= SWEEP_INTERVAL_MS) {
        lastSweepAt = Date.now();
        void sweepExpiredReplayOperations(pool);
    }
    const result = await pool.query(`INSERT INTO security_operation_replay_guard (operation_scope, operation_id, actor_id, expires_at)
     VALUES ($1, $2, $3, NOW() + (($4)::text || ' seconds')::interval)
     ON CONFLICT (operation_scope, operation_id) DO NOTHING
     RETURNING id`, [scope, operationId, actorId, ttlSeconds]);
    if (result.rowCount === 0)
        return { ok: false, reason: "replay_detected", operationId };
    return { ok: true, operationId };
}
