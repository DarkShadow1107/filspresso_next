import {
  BadRequestException, Injectable, NotFoundException,
} from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { DatabaseService } from "../database/database.service";

const VALID_MODEL_TYPES = ["tanka_semantic", "tanka_chemistry"] as const;
type ModelType = typeof VALID_MODEL_TYPES[number];
const VALID_ROLES = ["user", "assistant", "system"] as const;

@Injectable()
export class ChatService {
  constructor(private readonly db: DatabaseService) {}

  async getSessions(accountId: number, limit: number, offset: number): Promise<unknown> {
    const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 20, 1), 100);
    const safeOffset = Math.max(Number.isInteger(offset) ? offset : 0, 0);
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const [sessions, count] = await Promise.all([
        client.query(
          `SELECT id, session_uuid, title, model_type, ai_enabled, message_count, created_at, updated_at
           FROM chat_sessions WHERE account_id = $1 AND is_active = TRUE
           ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
          [accountId, safeLimit, safeOffset],
        ),
        client.query(
          "SELECT COUNT(*) as total FROM chat_sessions WHERE account_id = $1 AND is_active = TRUE",
          [accountId],
        ),
      ]);
      return { sessions: sessions.rows, total: Number(count.rows[0]?.total || 0) };
    } finally { client.release(); }
  }

  async getSession(accountId: number, uuid: string, messageLimit: number): Promise<unknown> {
    const safeLimit = Math.min(Math.max(Number.isInteger(messageLimit) ? messageLimit : 50, 1), 200);
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const sessionResult = await client.query(
        `SELECT id, session_uuid, title, model_type, ai_enabled, message_count, created_at, updated_at
         FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2`,
        [uuid, accountId],
      );
      const session = sessionResult.rows[0];
      if (!session) throw new NotFoundException({ error: "Session not found" });
      const messages = await client.query(
        `SELECT id, role, content, tokens_used, response_time_ms, created_at
         FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2`,
        [session.id, safeLimit],
      );
      return { session, messages: messages.rows };
    } finally { client.release(); }
  }

  async createSession(accountId: number, body: { title?: string; modelType?: string; aiEnabled?: boolean }): Promise<unknown> {
    const modelType = String(body.modelType || "tanka_semantic") as ModelType;
    if (!VALID_MODEL_TYPES.includes(modelType)) {
      throw new BadRequestException({ error: `Invalid model type. Valid types: ${VALID_MODEL_TYPES.join(", ")}` });
    }
    const sessionUuid = uuidv4();
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO chat_sessions (account_id, session_uuid, title, model_type, ai_enabled)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [accountId, sessionUuid, body.title || "New Chat", modelType, body.aiEnabled !== false],
      );
      return {
        message: "Session created",
        session: {
          id: result.rows[0].id, session_uuid: sessionUuid,
          title: body.title || "New Chat", model_type: modelType, ai_enabled: body.aiEnabled !== false,
        },
      };
    } finally { client.release(); }
  }

  async addMessage(accountId: number, uuid: string, body: { role?: string; content?: string; tokensUsed?: number; responseTimeMs?: number }): Promise<unknown> {
    const { role, content } = body;
    if (!role || !content) throw new BadRequestException({ error: "Role and content are required" });
    if (!VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
      throw new BadRequestException({ error: "Invalid role" });
    }
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const sessionResult = await client.query(
        "SELECT id FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2",
        [uuid, accountId],
      );
      const session = sessionResult.rows[0];
      if (!session) throw new NotFoundException({ error: "Session not found" });
      const result = await client.query(
        `INSERT INTO chat_messages (session_id, role, content, tokens_used, response_time_ms)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [session.id, role, content, body.tokensUsed || 0, body.responseTimeMs || 0],
      );
      await client.query(
        "UPDATE chat_sessions SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1",
        [session.id],
      );
      if (role === "user") {
        const firstMsg = await client.query(
          "SELECT content FROM chat_messages WHERE session_id = $1 AND role = 'user' ORDER BY created_at ASC LIMIT 1",
          [session.id],
        );
        if (firstMsg.rows[0]) {
          const autoTitle = String(firstMsg.rows[0].content).slice(0, 50) + (String(firstMsg.rows[0].content).length > 50 ? "..." : "");
          await client.query("UPDATE chat_sessions SET title = $1 WHERE id = $2 AND title = $3", [autoTitle, session.id, "New Chat"]);
        }
      }
      return { message: "Message added", messageId: result.rows[0].id };
    } finally { client.release(); }
  }

  async updateSession(accountId: number, uuid: string, body: { title?: string; modelType?: string; aiEnabled?: boolean }): Promise<unknown> {
    if (body.modelType !== undefined && !VALID_MODEL_TYPES.includes(body.modelType as ModelType)) {
      throw new BadRequestException({ error: `Invalid model type. Valid types: ${VALID_MODEL_TYPES.join(", ")}` });
    }
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const sessionResult = await client.query("SELECT id FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2", [uuid, accountId]);
      if (!sessionResult.rows[0]) throw new NotFoundException({ error: "Session not found" });
      const updates: string[] = [];
      const params: unknown[] = [];
      if (body.title !== undefined) { params.push(body.title); updates.push(`title = $${params.length}`); }
      if (body.modelType !== undefined) { params.push(body.modelType); updates.push(`model_type = $${params.length}`); }
      if (body.aiEnabled !== undefined) { params.push(body.aiEnabled); updates.push(`ai_enabled = $${params.length}`); }
      if (updates.length > 0) {
        params.push(sessionResult.rows[0].id);
        await client.query(`UPDATE chat_sessions SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${params.length}`, params);
      }
      return { message: "Session updated" };
    } finally { client.release(); }
  }

  async deleteSession(accountId: number, uuid: string): Promise<unknown> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const sessionResult = await client.query("SELECT id FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2", [uuid, accountId]);
      if (!sessionResult.rows[0]) throw new NotFoundException({ error: "Session not found" });
      await client.query("UPDATE chat_sessions SET is_active = FALSE, updated_at = NOW() WHERE id = $1", [sessionResult.rows[0].id]);
      return { message: "Session deleted" };
    } finally { client.release(); }
  }
}
