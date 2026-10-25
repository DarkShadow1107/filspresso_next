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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaygroundSessionsService = exports.InvalidSessionInputError = void 0;
exports.normalizeActiveContext = normalizeActiveContext;
exports.normalizeSourceReferences = normalizeSourceReferences;
exports.normalizeSessionWrite = normalizeSessionWrite;
exports.normalizeClientSessionId = normalizeClientSessionId;
const common_1 = require("@nestjs/common");
const uuid_1 = require("uuid");
const database_service_1 = require("../database/database.service");
const playground_run_events_service_1 = require("./playground-run-events.service");
const text_models_1 = require("./text-models");
/**
 * Account-scoped resume state for the Playground.
 *
 * This is deliberately *not* a transcript store. Both clients keep conversations client-local,
 * and `ENHANCEMENT.md` leaves cross-device sync as an open product question; making the server
 * a second, quieter copy of every message would settle that question silently and in the wrong
 * place before anyone had decided anything. What this table holds is the *active context*: the
 * client's preferences, named source references (never the source text), and the last
 * compaction checkpoint -- the state a conversation needs to continue coherently after a reload
 * or to be handed to the other client without shipping its whole history.
 *
 * ## Additive on purpose
 *
 * Nothing here touches chat_sessions, the Kafelot surface or the desktop endpoints: routes are
 * new, tables are new, and the only shared contract is the shape this service returns, which
 * follows ChatService's snake_case rows so both clients read one spelling.
 */
const MAX_TITLE = 120;
const MAX_ACTIVE_HISTORY_TURNS = 100;
const MAX_ACTIVE_CONTEXT_TOTAL = 700_000;
const MAX_SESSION_SUMMARY = 8_000;
const MAX_SOURCE_BODY = 200_000;
const MAX_SOURCE_REFERENCES = 12;
const MAX_SOURCE_NAME = 240;
const MAX_SOURCE_URL = 2048;
/** Same levels and closed compaction set as input-context.ts, so the clients cannot disagree through different tables. */
const CONTEXT_LEVELS = [16_384, 32_768, 65_536, 131_072];
const COMPACTION_MODES = new Set(["permissive", "balanced", "aggressive"]);
const ACTIVE_ROLES = ["user", "assistant"];
/** Both clients' default model; the sessions API falling back to the cheapest keeps the ladder consistent. */
const DEFAULT_MODEL_KEY = (0, text_models_1.playgroundTextModelKeys)()[0];
/**
 * The compaction checkpoint, clamped to the same ceilings the live request applies
 * (turn count and per-turn size mirror input-context.ts; the total sits below the API body
 * ceiling). A turn that fails a clamp is dropped rather than truncated: half a turn would
 * make the checkpoint claim history that never happened.
 */
function normalizeActiveContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    const input = value;
    const result = {};
    const ids = Array.isArray(input.ids) ? input.ids.filter((item) => typeof item === "string" && item.length <= 64).slice(0, MAX_ACTIVE_HISTORY_TURNS) : [];
    if (ids.length)
        result.ids = ids;
    const history = [];
    for (const raw of Array.isArray(input.history) ? input.history : []) {
        if (!raw || typeof raw !== "object")
            continue;
        const turn = raw;
        if (typeof turn.role !== "string" || !ACTIVE_ROLES.includes(turn.role))
            continue;
        if (typeof turn.content !== "string")
            continue;
        if (turn.content.length > MAX_SOURCE_BODY)
            break;
        history.push({ role: turn.role, content: turn.content });
        if (history.length >= MAX_ACTIVE_HISTORY_TURNS)
            break;
    }
    // The per-turn ceiling does not know the running total; drop from the oldest end until
    // the checkpoint fits, keeping the newest turns -- the ones the next request needs.
    while (history.length && total_of(history) > MAX_ACTIVE_CONTEXT_TOTAL)
        history.shift();
    if (history.length)
        result.history = history;
    for (const key of ["tokensBefore", "tokensAfter"]) {
        const n = Number(input[key]);
        if (Number.isFinite(n) && n >= 0)
            result[key] = Math.floor(n);
    }
    if (typeof input.mode === "string" && COMPACTION_MODES.has(input.mode))
        result.mode = input.mode;
    if (typeof input.summary === "string")
        result.summary = input.summary.slice(0, MAX_SESSION_SUMMARY);
    return result;
}
function total_of(history) {
    return history.reduce((size, turn) => size + turn.content.length, 0);
}
/**
 * References, not sources. Text is intentionally absent: it belongs to the transcript class
 * of data, and storing source bodies here would reopen the retention question the whole
 * design avoids.
 */
function normalizeSourceReferences(value) {
    if (!Array.isArray(value))
        return [];
    const references = [];
    for (const raw of value.slice(0, MAX_SOURCE_REFERENCES)) {
        if (!raw || typeof raw !== "object")
            continue;
        const item = raw;
        const reference = {};
        if (typeof item.name === "string" && item.name)
            reference.name = item.name.slice(0, MAX_SOURCE_NAME);
        if (typeof item.sourceUrl === "string") {
            const url = item.sourceUrl.slice(0, MAX_SOURCE_URL);
            if (/^https?:\/\//.test(url))
                reference.sourceUrl = url;
        }
        if (typeof item.kind === "string")
            reference.kind = item.kind.slice(0, 32);
        const size = Number(item.size);
        if (Number.isFinite(size) && size >= 0)
            reference.size = Math.floor(size);
        if (Object.keys(reference).length)
            references.push(reference);
    }
    return references;
}
/**
 * Validate one session write. Throws InvalidSessionInputError; the controller is the HTTP boundary and
 * turns it into a 400, the same split readInputContext and the gateway already use.
 */
class InvalidSessionInputError extends Error {
}
exports.InvalidSessionInputError = InvalidSessionInputError;
function normalizeSessionWrite(body) {
    const update = {};
    if (typeof body.title === "string" && body.title.trim())
        update.title = body.title.trim().slice(0, MAX_TITLE);
    if (typeof body.model === "string" && body.model.trim()) {
        if ((0, text_models_1.playgroundModelFile)(body.model.trim()) === null)
            throw new InvalidSessionInputError("That model is not available in the Playground.");
        update.modelKey = body.model.trim();
    }
    if (body.inputContextTokens !== undefined) {
        const n = Number(body.inputContextTokens);
        if (!CONTEXT_LEVELS.includes(n))
            throw new InvalidSessionInputError("Choose a 16K, 32K, 64K or 128K input context.");
        update.inputContextTokens = n;
    }
    if (body.compactionMode !== undefined) {
        if (typeof body.compactionMode !== "string" || !COMPACTION_MODES.has(body.compactionMode))
            throw new InvalidSessionInputError("Choose Permissive, Balanced or Aggressive compaction.");
        update.compactionMode = body.compactionMode;
    }
    if (body.activeContext !== undefined)
        update.activeContext = normalizeActiveContext(body.activeContext);
    if (body.sourceReferences !== undefined)
        update.sourceReferences = normalizeSourceReferences(body.sourceReferences);
    return update;
}
/**
 * A client may name a conversation for its run events. The value comes from the request, so
 * it is still validated as a UUID -- a value that is not one gets no row and no linkage,
 * quietly and on purpose: session_uuid on a run event is optional for exactly this reason.
 */
function normalizeClientSessionId(value) {
    return (0, playground_run_events_service_1.normalizeSessionUuid)(value);
}
let PlaygroundSessionsService = class PlaygroundSessionsService {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(accountId, body) {
        const update = normalizeSessionWrite(body);
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query(`INSERT INTO playground_sessions (account_id, session_uuid, title, model_key, input_context_tokens, compaction_mode, active_context, source_references)
				 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) RETURNING *`, [accountId, (0, uuid_1.v4)(), update.title ?? "New conversation", update.modelKey ?? DEFAULT_MODEL_KEY, update.inputContextTokens ?? 16_384, update.compactionMode ?? "balanced", JSON.stringify(update.activeContext ?? {}), JSON.stringify(update.sourceReferences ?? [])]);
            return result.rows[0];
        }
        finally {
            client.release();
        }
    }
    async list(accountId, limit = 50, offset = 0) {
        const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), 200);
        const safeOffset = Math.max(Number.isInteger(offset) ? offset : 0, 0);
        const client = await this.db.getPool().connect();
        try {
            const [sessions, count] = await Promise.all([
                client.query(`SELECT session_uuid, title, model_key, input_context_tokens, compaction_mode, source_references, created_at, updated_at
					 FROM playground_sessions WHERE account_id = $1 AND is_active = TRUE
					 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`, [accountId, safeLimit, safeOffset]),
                client.query("SELECT COUNT(*) AS total FROM playground_sessions WHERE account_id = $1 AND is_active = TRUE", [accountId]),
            ]);
            return { sessions: sessions.rows, total: Number(count.rows[0]?.total ?? 0) };
        }
        finally {
            client.release();
        }
    }
    async get(accountId, uuid) {
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query(`SELECT session_uuid, title, model_key, input_context_tokens, compaction_mode, active_context, source_references, created_at, updated_at
				 FROM playground_sessions WHERE session_uuid = $1 AND account_id = $2 AND is_active = TRUE`, [uuid, accountId]);
            if (!result.rows[0])
                throw new common_1.NotFoundException({ error: "Session not found" });
            return result.rows[0];
        }
        finally {
            client.release();
        }
    }
    async update(accountId, uuid, body) {
        const update = normalizeSessionWrite(body);
        if (Object.keys(update).length === 0)
            return this.get(accountId, uuid);
        const updates = ["updated_at = NOW()"];
        const params = [uuid, accountId];
        const bind = (column, value) => { updates.push(`${column} = $${params.push(value)}`); };
        if (update.title !== undefined)
            bind("title", update.title);
        if (update.modelKey !== undefined)
            bind("model_key", update.modelKey);
        if (update.inputContextTokens !== undefined)
            bind("input_context_tokens", update.inputContextTokens);
        if (update.compactionMode !== undefined)
            bind("compaction_mode", update.compactionMode);
        if (update.activeContext !== undefined)
            bind("active_context", JSON.stringify(update.activeContext));
        if (update.sourceReferences !== undefined)
            bind("source_references", JSON.stringify(update.sourceReferences));
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query(`UPDATE playground_sessions SET ${updates.join(", ")}
				 WHERE session_uuid = $1 AND account_id = $2 AND is_active = TRUE RETURNING *`, params);
            if (!result.rows[0])
                throw new common_1.NotFoundException({ error: "Session not found" });
            return result.rows[0];
        }
        finally {
            client.release();
        }
    }
    /** Soft delete. The row (and its session-linked events) are purged later by retention, or explicitly by ?purge=1. */
    async delete(accountId, uuid) {
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query(`UPDATE playground_sessions SET is_active = FALSE, updated_at = NOW()
				 WHERE session_uuid = $1 AND account_id = $2 AND is_active = TRUE RETURNING id`, [uuid, accountId]);
            return Boolean(result.rows[0]);
        }
        finally {
            client.release();
        }
    }
};
exports.PlaygroundSessionsService = PlaygroundSessionsService;
exports.PlaygroundSessionsService = PlaygroundSessionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], PlaygroundSessionsService);
