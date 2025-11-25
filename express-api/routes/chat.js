/**
 * Chat Routes (AI conversation history)
 * GET /api/chat/sessions - Get user's chat sessions
 * GET /api/chat/sessions/:id - Get session with messages
 * POST /api/chat/sessions - Create new session
 * POST /api/chat/sessions/:id/messages - Add message to session
 * DELETE /api/chat/sessions/:id - Delete session
 */

const express = require("express");
const pool = require("../db/connection");
const { authenticate } = require("../middleware/auth");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

/**
 * Get all chat sessions for user
 */
router.get("/sessions", authenticate, async (req, res) => {
	try {
		const { limit = 20, offset = 0 } = req.query;

		const conn = await pool.getConnection();
		try {
			const sessions = await conn.query(
				`SELECT id, session_uuid, title, model_type, ai_enabled, 
                message_count, created_at, updated_at
         FROM chat_sessions 
         WHERE account_id = ? AND is_active = TRUE
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
				[req.user.id, parseInt(limit), parseInt(offset)]
			);

			const [countResult] = await conn.query(
				"SELECT COUNT(*) as total FROM chat_sessions WHERE account_id = ? AND is_active = TRUE",
				[req.user.id]
			);

			res.json({
				sessions,
				total: Number(countResult.total),
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get sessions error:", error);
		res.status(500).json({ error: "Failed to get chat sessions" });
	}
});

/**
 * Get session with messages
 */
router.get("/sessions/:uuid", authenticate, async (req, res) => {
	try {
		const { uuid } = req.params;
		const { messageLimit = 50 } = req.query;

		const conn = await pool.getConnection();
		try {
			const [session] = await conn.query(
				`SELECT id, session_uuid, title, model_type, ai_enabled, 
                message_count, created_at, updated_at
         FROM chat_sessions 
         WHERE session_uuid = ? AND account_id = ?`,
				[uuid, req.user.id]
			);

			if (!session) {
				return res.status(404).json({ error: "Session not found" });
			}

			const messages = await conn.query(
				`SELECT id, role, content, tokens_used, response_time_ms, created_at
         FROM chat_messages 
         WHERE session_id = ?
         ORDER BY created_at ASC
         LIMIT ?`,
				[session.id, parseInt(messageLimit)]
			);

			res.json({
				session,
				messages,
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get session error:", error);
		res.status(500).json({ error: "Failed to get chat session" });
	}
});

/**
 * Create new chat session
 */
router.post("/sessions", authenticate, async (req, res) => {
	try {
		const { title, modelType = "tanka", aiEnabled = true } = req.body;

		if (!["tanka", "villanelle", "ode", "chemistry"].includes(modelType)) {
			return res.status(400).json({ error: "Invalid model type" });
		}

		const conn = await pool.getConnection();
		try {
			const sessionUuid = uuidv4();

			const result = await conn.query(
				`INSERT INTO chat_sessions 
         (account_id, session_uuid, title, model_type, ai_enabled)
         VALUES (?, ?, ?, ?, ?)`,
				[req.user.id, sessionUuid, title || "New Chat", modelType, aiEnabled]
			);

			res.status(201).json({
				message: "Session created",
				session: {
					id: Number(result.insertId),
					session_uuid: sessionUuid,
					title: title || "New Chat",
					model_type: modelType,
					ai_enabled: aiEnabled,
				},
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Create session error:", error);
		res.status(500).json({ error: "Failed to create chat session" });
	}
});

/**
 * Add message to session
 */
router.post("/sessions/:uuid/messages", authenticate, async (req, res) => {
	try {
		const { uuid } = req.params;
		const { role, content, tokensUsed = 0, responseTimeMs = 0 } = req.body;

		if (!role || !content) {
			return res.status(400).json({ error: "Role and content are required" });
		}

		if (!["user", "assistant", "system"].includes(role)) {
			return res.status(400).json({ error: "Invalid role" });
		}

		const conn = await pool.getConnection();
		try {
			const [session] = await conn.query("SELECT id FROM chat_sessions WHERE session_uuid = ? AND account_id = ?", [
				uuid,
				req.user.id,
			]);

			if (!session) {
				return res.status(404).json({ error: "Session not found" });
			}

			const result = await conn.query(
				`INSERT INTO chat_messages 
         (session_id, role, content, tokens_used, response_time_ms)
         VALUES (?, ?, ?, ?, ?)`,
				[session.id, role, content, tokensUsed, responseTimeMs]
			);

			// Update session
			await conn.query(
				`UPDATE chat_sessions 
         SET message_count = message_count + 1, updated_at = NOW()
         WHERE id = ?`,
				[session.id]
			);

			// Auto-generate title from first user message
			const [firstMessage] = await conn.query(
				`SELECT content FROM chat_messages 
         WHERE session_id = ? AND role = 'user' 
         ORDER BY created_at ASC LIMIT 1`,
				[session.id]
			);

			if (firstMessage && role === "user") {
				const autoTitle = firstMessage.content.slice(0, 50) + (firstMessage.content.length > 50 ? "..." : "");
				await conn.query("UPDATE chat_sessions SET title = ? WHERE id = ? AND title = ?", [
					autoTitle,
					session.id,
					"New Chat",
				]);
			}

			res.status(201).json({
				message: "Message added",
				messageId: Number(result.insertId),
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Add message error:", error);
		res.status(500).json({ error: "Failed to add message" });
	}
});

/**
 * Update session (title, model type, etc.)
 */
router.put("/sessions/:uuid", authenticate, async (req, res) => {
	try {
		const { uuid } = req.params;
		const { title, modelType, aiEnabled } = req.body;

		const conn = await pool.getConnection();
		try {
			const [session] = await conn.query("SELECT id FROM chat_sessions WHERE session_uuid = ? AND account_id = ?", [
				uuid,
				req.user.id,
			]);

			if (!session) {
				return res.status(404).json({ error: "Session not found" });
			}

			const updates = [];
			const params = [];

			if (title !== undefined) {
				updates.push("title = ?");
				params.push(title);
			}
			if (modelType !== undefined) {
				if (!["tanka", "villanelle", "ode", "chemistry"].includes(modelType)) {
					return res.status(400).json({ error: "Invalid model type" });
				}
				updates.push("model_type = ?");
				params.push(modelType);
			}
			if (aiEnabled !== undefined) {
				updates.push("ai_enabled = ?");
				params.push(aiEnabled);
			}

			if (updates.length > 0) {
				params.push(session.id);
				await conn.query(`UPDATE chat_sessions SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`, params);
			}

			res.json({ message: "Session updated" });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Update session error:", error);
		res.status(500).json({ error: "Failed to update session" });
	}
});

/**
 * Delete session (soft delete)
 */
router.delete("/sessions/:uuid", authenticate, async (req, res) => {
	try {
		const { uuid } = req.params;

		const conn = await pool.getConnection();
		try {
			const [session] = await conn.query("SELECT id FROM chat_sessions WHERE session_uuid = ? AND account_id = ?", [
				uuid,
				req.user.id,
			]);

			if (!session) {
				return res.status(404).json({ error: "Session not found" });
			}

			// Soft delete
			await conn.query("UPDATE chat_sessions SET is_active = FALSE, updated_at = NOW() WHERE id = ?", [session.id]);

			res.json({ message: "Session deleted" });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Delete session error:", error);
		res.status(500).json({ error: "Failed to delete session" });
	}
});

module.exports = router;
