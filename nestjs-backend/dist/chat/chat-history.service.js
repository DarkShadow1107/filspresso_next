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
exports.ChatHistoryService = void 0;
exports.chatMemoryLimitForTier = chatMemoryLimitForTier;
const common_1 = require("@nestjs/common");
const uuid_1 = require("uuid");
const database_service_1 = require("../database/database.service");
/**
 * Conversations retained per plan.
 *
 * This used to live only in the browser (`CHAT_MEMORY_LIMIT_BY_TIER` in
 * CoffeeRecommender) and was used for nothing but a stats panel, so nothing
 * actually capped anything. Enforcing it here is what makes the number real: the
 * oldest conversations beyond the cap are soft-deleted on every write, so a
 * downgrade takes effect immediately and a user cannot simply keep posting to
 * exceed their allowance.
 *
 * `none` and `free` share the anonymous allowance because an anonymous caller has
 * no account to attach rows to.
 */
const CHAT_MEMORY_LIMIT_BY_TIER = {
    none: 5,
    free: 5,
    basic: 20,
    plus: 50,
    pro: 100,
    max: 200,
    ultimate: 200,
};
const VALID_ROLES = new Set(["user", "assistant", "system"]);
const VALID_CATEGORIES = new Set(["coffee", "chemistry", "general"]);
function chatMemoryLimitForTier(tier) {
    const key = String(tier || "none").trim().toLowerCase();
    return CHAT_MEMORY_LIMIT_BY_TIER[key] ?? CHAT_MEMORY_LIMIT_BY_TIER.none;
}
let ChatHistoryService = class ChatHistoryService {
    db;
    constructor(db) {
        this.db = db;
    }
    // ---------------------------------------------------------------- existing API
    async getSessions(accountId, limit = 20, offset = 0) {
        const pool = this.db.getPool();
        const safeLimit = Math.min(Math.max(1, limit), 100);
        const safeOffset = Math.max(0, offset);
        const result = await pool.query(`SELECT id, session_uuid, title, model_type, category, message_count, created_at, updated_at
       FROM chat_sessions
       WHERE account_id = $1 AND is_active = TRUE
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`, [accountId, safeLimit, safeOffset]);
        return { sessions: result.rows };
    }
    async getSession(accountId, sessionUuid, messageLimit = 50) {
        const pool = this.db.getPool();
        const safeLimit = Math.min(Math.max(1, messageLimit), 200);
        const session = await pool.query(`SELECT * FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2 AND is_active = TRUE`, [sessionUuid, accountId]);
        if (!session.rows[0])
            return null;
        const messages = await pool.query(`SELECT id, role, content, metadata, tokens_used, response_time_ms, created_at
       FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2`, [session.rows[0].id, safeLimit]);
        return { session: session.rows[0], messages: messages.rows };
    }
    async createSession(accountId, input) {
        const pool = this.db.getPool();
        const modelType = normalizeModelType(input.modelType);
        const result = await pool.query(`INSERT INTO chat_sessions (account_id, session_uuid, title, model_type, ai_enabled)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`, [accountId, (0, uuid_1.v4)(), (input.title || "New Chat").slice(0, 255), modelType, input.aiEnabled !== false]);
        return { session: result.rows[0] };
    }
    async addMessage(accountId, sessionUuid, input) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const session = await client.query(`SELECT id FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2 AND is_active = TRUE`, [sessionUuid, accountId]);
            if (!session.rows[0])
                return null;
            const role = VALID_ROLES.has(String(input.role)) ? String(input.role) : "user";
            const inserted = await client.query(`INSERT INTO chat_messages (session_id, role, content, metadata, tokens_used, response_time_ms)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [
                session.rows[0].id,
                role,
                String(input.content ?? ""),
                input.metadata ? JSON.stringify(input.metadata) : null,
                Number(input.tokensUsed) || 0,
                Number(input.responseTimeMs) || 0,
            ]);
            await client.query(`UPDATE chat_sessions SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1`, [session.rows[0].id]);
            return { message: inserted.rows[0] };
        }
        finally {
            client.release();
        }
    }
    async updateSession(accountId, sessionUuid, input) {
        const pool = this.db.getPool();
        const sets = [];
        const params = [sessionUuid, accountId];
        if (typeof input.title === "string") {
            params.push(input.title.slice(0, 255));
            sets.push(`title = $${params.length}`);
        }
        if (typeof input.modelType === "string") {
            params.push(normalizeModelType(input.modelType));
            sets.push(`model_type = $${params.length}`);
        }
        if (typeof input.aiEnabled === "boolean") {
            params.push(input.aiEnabled);
            sets.push(`ai_enabled = $${params.length}`);
        }
        if (!sets.length)
            return { session: null };
        const result = await pool.query(`UPDATE chat_sessions SET ${sets.join(", ")}, updated_at = NOW()
       WHERE session_uuid = $1 AND account_id = $2 AND is_active = TRUE RETURNING *`, params);
        return { session: result.rows[0] ?? null };
    }
    async deleteSession(accountId, sessionUuid) {
        const pool = this.db.getPool();
        // Soft delete: the audit trail is kept, matching the previous behaviour of
        // `is_active = FALSE`.
        const result = await pool.query(`UPDATE chat_sessions SET is_active = FALSE, updated_at = NOW()
       WHERE session_uuid = $1 AND account_id = $2 RETURNING id`, [sessionUuid, accountId]);
        return { deleted: result.rowCount ?? 0 };
    }
    // ------------------------------------------------- full-history sync (new)
    /**
     * The whole conversation list for an account.
     *
     * Replaces the global `src/data/chat_history.json` blob, which was one shared
     * file for every visitor with no auth, no size cap and no per-account scoping.
     *
     * The key is `history`, not `conversations`, because both existing consumers
     * (`CoffeeRecommender` and `AccountManagement`) read `data.history`. Renaming it
     * would have silently stopped history loading in both places, since each guards
     * with `if (data.history && Array.isArray(...))`.
     */
    async listHistory(accountId) {
        const pool = this.db.getPool();
        const sessions = await pool.query(`SELECT id, session_uuid, title, model_type, category, metadata, message_count, created_at, updated_at
       FROM chat_sessions WHERE account_id = $1 AND is_active = TRUE
       ORDER BY created_at ASC, id ASC`, [accountId]);
        if (!sessions.rows.length)
            return { history: [] };
        const ids = sessions.rows.map((row) => row.id);
        const messages = await pool.query(`SELECT session_id, role, content, metadata, created_at
       FROM chat_messages WHERE session_id = ANY($1::int[])
       ORDER BY created_at ASC, id ASC`, [ids]);
        const bySession = new Map();
        for (const row of messages.rows) {
            const list = bySession.get(Number(row.session_id)) ?? [];
            list.push(row);
            bySession.set(Number(row.session_id), list);
        }
        return {
            history: sessions.rows.map((row) => {
                const meta = (row.metadata ?? {});
                const rows = (bySession.get(Number(row.id)) ?? []);
                return {
                    id: String(row.session_uuid),
                    timestamp: new Date(row.created_at).getTime(),
                    preview: String(row.title ?? ""),
                    model: typeof meta.model === "string" ? meta.model : undefined,
                    category: String(row.category ?? "general"),
                    messages: rows.map((message) => {
                        const messageMeta = (message.metadata ?? {});
                        return {
                            role: String(message.role),
                            content: String(message.content ?? ""),
                            ...messageMeta,
                        };
                    }),
                };
            }),
        };
    }
    /**
     * Replace the caller's conversation list with `conversations`.
     *
     * This is what the browser's "save" does today -- it POSTs its whole history
     * array -- so keeping a bulk endpoint is far less invasive than teaching the
     * client to issue N per-session requests, and it keeps one transaction.
     *
     * Sessions missing from the payload are soft-deleted, and the per-plan memory
     * cap is enforced by soft-deleting the oldest overflow.
     */
    async replaceHistory(accountId, conversations, tier) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const keep = [];
            for (const conversation of conversations) {
                // A browser-generated id like `chat-1775669298678` fits session_uuid, and
                // reusing it makes the replace idempotent.
                const sessionUuid = String(conversation.id || (0, uuid_1.v4)()).slice(0, 64);
                keep.push(sessionUuid);
                const category = VALID_CATEGORIES.has(String(conversation.category))
                    ? String(conversation.category)
                    : "general";
                const title = String(conversation.preview || firstUserText(conversation.messages) || "New Chat").slice(0, 255);
                const sessionMeta = conversation.model ? { model: conversation.model } : {};
                const upserted = await client.query(`INSERT INTO chat_sessions
             (account_id, session_uuid, title, model_type, category, metadata, is_active, message_count, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, NOW())
           ON CONFLICT (session_uuid) DO UPDATE
             SET title = EXCLUDED.title,
                 model_type = EXCLUDED.model_type,
                 category = EXCLUDED.category,
                 metadata = EXCLUDED.metadata,
                 is_active = TRUE,
                 message_count = EXCLUDED.message_count,
                 updated_at = NOW()
           WHERE chat_sessions.account_id = EXCLUDED.account_id
           RETURNING id`, [
                    accountId,
                    sessionUuid,
                    title,
                    category === "chemistry" ? "tanka_chemistry" : "tanka_semantic",
                    category,
                    JSON.stringify(sessionMeta),
                    Array.isArray(conversation.messages) ? conversation.messages.length : 0,
                ]);
                // The ON CONFLICT ... WHERE guard means a uuid owned by another account
                // returns no row. Silently skip rather than letting it read as someone
                // else's conversation.
                const sessionId = Number(upserted.rows[0]?.id ?? 0);
                if (!sessionId)
                    continue;
                await client.query(`DELETE FROM chat_messages WHERE session_id = $1`, [sessionId]);
                for (const message of Array.isArray(conversation.messages) ? conversation.messages : []) {
                    const role = VALID_ROLES.has(String(message?.role)) ? String(message?.role) : "user";
                    const { role: _role, content: _content, ...meta } = message ?? {};
                    await client.query(`INSERT INTO chat_messages (session_id, role, content, metadata)
             VALUES ($1, $2, $3, $4)`, [sessionId, role, String(message?.content ?? ""), JSON.stringify(meta)]);
                }
            }
            // Anything the client no longer has is gone (a deleted conversation).
            await client.query(`UPDATE chat_sessions SET is_active = FALSE, updated_at = NOW()
         WHERE account_id = $1 AND is_active = TRUE
           AND NOT (session_uuid = ANY($2::text[]))`, [accountId, keep]);
            // Enforce the plan's retention cap: soft-delete the oldest overflow.
            const cap = chatMemoryLimitForTier(tier);
            await client.query(`UPDATE chat_sessions SET is_active = FALSE, updated_at = NOW()
         WHERE id IN (
           SELECT id FROM chat_sessions
           WHERE account_id = $1 AND is_active = TRUE
           ORDER BY created_at DESC, id DESC
           OFFSET $2
         )`, [accountId, cap]);
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw err;
        }
        finally {
            client.release();
        }
        return this.listHistory(accountId);
    }
};
exports.ChatHistoryService = ChatHistoryService;
exports.ChatHistoryService = ChatHistoryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], ChatHistoryService);
function normalizeModelType(value) {
    return value === "tanka_chemistry" ? "tanka_chemistry" : "tanka_semantic";
}
function firstUserText(messages) {
    if (!Array.isArray(messages))
        return "";
    for (const message of messages) {
        if (message?.role === "user" && message.content)
            return String(message.content).slice(0, 80);
    }
    return "";
}
