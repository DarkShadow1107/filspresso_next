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
exports.ChatService = void 0;
const common_1 = require("@nestjs/common");
const uuid_1 = require("uuid");
const database_service_1 = require("../database/database.service");
const VALID_MODEL_TYPES = ["tanka_semantic", "tanka_chemistry"];
const VALID_ROLES = ["user", "assistant", "system"];
let ChatService = class ChatService {
    db;
    constructor(db) {
        this.db = db;
    }
    async getSessions(accountId, limit, offset) {
        const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 20, 1), 100);
        const safeOffset = Math.max(Number.isInteger(offset) ? offset : 0, 0);
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const [sessions, count] = await Promise.all([
                client.query(`SELECT id, session_uuid, title, model_type, ai_enabled, message_count, created_at, updated_at
           FROM chat_sessions WHERE account_id = $1 AND is_active = TRUE
           ORDER BY updated_at DESC LIMIT $2 OFFSET $3`, [accountId, safeLimit, safeOffset]),
                client.query("SELECT COUNT(*) as total FROM chat_sessions WHERE account_id = $1 AND is_active = TRUE", [accountId]),
            ]);
            return { sessions: sessions.rows, total: Number(count.rows[0]?.total || 0) };
        }
        finally {
            client.release();
        }
    }
    async getSession(accountId, uuid, messageLimit) {
        const safeLimit = Math.min(Math.max(Number.isInteger(messageLimit) ? messageLimit : 50, 1), 200);
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const sessionResult = await client.query(`SELECT id, session_uuid, title, model_type, ai_enabled, message_count, created_at, updated_at
         FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2`, [uuid, accountId]);
            const session = sessionResult.rows[0];
            if (!session)
                throw new common_1.NotFoundException({ error: "Session not found" });
            const messages = await client.query(`SELECT id, role, content, tokens_used, response_time_ms, created_at
         FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2`, [session.id, safeLimit]);
            return { session, messages: messages.rows };
        }
        finally {
            client.release();
        }
    }
    async createSession(accountId, body) {
        const modelType = String(body.modelType || "tanka_semantic");
        if (!VALID_MODEL_TYPES.includes(modelType)) {
            throw new common_1.BadRequestException({ error: `Invalid model type. Valid types: ${VALID_MODEL_TYPES.join(", ")}` });
        }
        const sessionUuid = (0, uuid_1.v4)();
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`INSERT INTO chat_sessions (account_id, session_uuid, title, model_type, ai_enabled)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`, [accountId, sessionUuid, body.title || "New Chat", modelType, body.aiEnabled !== false]);
            return {
                message: "Session created",
                session: {
                    id: result.rows[0].id, session_uuid: sessionUuid,
                    title: body.title || "New Chat", model_type: modelType, ai_enabled: body.aiEnabled !== false,
                },
            };
        }
        finally {
            client.release();
        }
    }
    async addMessage(accountId, uuid, body) {
        const { role, content } = body;
        if (!role || !content)
            throw new common_1.BadRequestException({ error: "Role and content are required" });
        if (!VALID_ROLES.includes(role)) {
            throw new common_1.BadRequestException({ error: "Invalid role" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const sessionResult = await client.query("SELECT id FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2", [uuid, accountId]);
            const session = sessionResult.rows[0];
            if (!session)
                throw new common_1.NotFoundException({ error: "Session not found" });
            const result = await client.query(`INSERT INTO chat_messages (session_id, role, content, tokens_used, response_time_ms)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`, [session.id, role, content, body.tokensUsed || 0, body.responseTimeMs || 0]);
            await client.query("UPDATE chat_sessions SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1", [session.id]);
            if (role === "user") {
                const firstMsg = await client.query("SELECT content FROM chat_messages WHERE session_id = $1 AND role = 'user' ORDER BY created_at ASC LIMIT 1", [session.id]);
                if (firstMsg.rows[0]) {
                    const autoTitle = String(firstMsg.rows[0].content).slice(0, 50) + (String(firstMsg.rows[0].content).length > 50 ? "..." : "");
                    await client.query("UPDATE chat_sessions SET title = $1 WHERE id = $2 AND title = $3", [autoTitle, session.id, "New Chat"]);
                }
            }
            return { message: "Message added", messageId: result.rows[0].id };
        }
        finally {
            client.release();
        }
    }
    async updateSession(accountId, uuid, body) {
        if (body.modelType !== undefined && !VALID_MODEL_TYPES.includes(body.modelType)) {
            throw new common_1.BadRequestException({ error: `Invalid model type. Valid types: ${VALID_MODEL_TYPES.join(", ")}` });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const sessionResult = await client.query("SELECT id FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2", [uuid, accountId]);
            if (!sessionResult.rows[0])
                throw new common_1.NotFoundException({ error: "Session not found" });
            const updates = [];
            const params = [];
            if (body.title !== undefined) {
                params.push(body.title);
                updates.push(`title = $${params.length}`);
            }
            if (body.modelType !== undefined) {
                params.push(body.modelType);
                updates.push(`model_type = $${params.length}`);
            }
            if (body.aiEnabled !== undefined) {
                params.push(body.aiEnabled);
                updates.push(`ai_enabled = $${params.length}`);
            }
            if (updates.length > 0) {
                params.push(sessionResult.rows[0].id);
                await client.query(`UPDATE chat_sessions SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${params.length}`, params);
            }
            return { message: "Session updated" };
        }
        finally {
            client.release();
        }
    }
    async deleteSession(accountId, uuid) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const sessionResult = await client.query("SELECT id FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2", [uuid, accountId]);
            if (!sessionResult.rows[0])
                throw new common_1.NotFoundException({ error: "Session not found" });
            await client.query("UPDATE chat_sessions SET is_active = FALSE, updated_at = NOW() WHERE id = $1", [sessionResult.rows[0].id]);
            return { message: "Session deleted" };
        }
        finally {
            client.release();
        }
    }
};
exports.ChatService = ChatService;
exports.ChatService = ChatService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], ChatService);
