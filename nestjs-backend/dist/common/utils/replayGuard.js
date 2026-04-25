"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeOperationId = normalizeOperationId;
exports.extractOperationId = extractOperationId;
exports.resolveActorId = resolveActorId;
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
async function reserveReplayOperation(pool, options = {}) {
    const scope = String(options.scope || "global").trim().slice(0, 64) || "global";
    const actorId = String(options.actorId || "anonymous").trim().slice(0, 128) || "anonymous";
    const ttlSeconds = Math.min(Math.max(Number.parseInt(options.ttlSeconds || String(DEFAULT_REPLAY_TTL_SECONDS), 10) || DEFAULT_REPLAY_TTL_SECONDS, 60), 86400);
    const operationId = normalizeOperationId(options.operationId);
    if (!operationId)
        return { ok: false, reason: "invalid_operation_id" };
    try {
        await pool.query("DELETE FROM security_operation_replay_guard WHERE expires_at < NOW()");
    }
    catch { }
    const result = await pool.query(`INSERT INTO security_operation_replay_guard (operation_scope, operation_id, actor_id, expires_at)
     VALUES ($1, $2, $3, NOW() + (($4)::text || ' seconds')::interval)
     ON CONFLICT (operation_scope, operation_id) DO NOTHING
     RETURNING id`, [scope, operationId, actorId, ttlSeconds]);
    if (result.rowCount === 0)
        return { ok: false, reason: "replay_detected", operationId };
    return { ok: true, operationId };
}
