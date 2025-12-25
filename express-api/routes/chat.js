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

		const client = await pool.connect();
		try {
			const result = await client.query(
				`SELECT id, session_uuid, title, model_type, ai_enabled, 
                message_count, created_at, updated_at
        FROM chat_sessions 
        WHERE account_id = $1 AND is_active = TRUE
        ORDER BY updated_at DESC
        LIMIT $2 OFFSET $3`,
				[req.user.id, parseInt(limit), parseInt(offset)]
			);
			const sessions = result.rows;

			const countResult = await client.query(
				"SELECT COUNT(*) as total FROM chat_sessions WHERE account_id = $1 AND is_active = TRUE",
				[req.user.id]
			);

			res.json({
				sessions,
				total: Number(countResult.rows[0].total),
			});
		} finally {
			client.release();
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

		const client = await pool.connect();
		try {
			const result = await client.query(
				`SELECT id, session_uuid, title, model_type, ai_enabled, 
                message_count, created_at, updated_at
        FROM chat_sessions 
        WHERE session_uuid = $1 AND account_id = $2`,
				[uuid, req.user.id]
			);
			const session = result.rows[0];

			if (!session) {
				return res.status(404).json({ error: "Session not found" });
			}

			const messagesResult = await client.query(
				`SELECT id, role, content, tokens_used, response_time_ms, created_at
        FROM chat_messages 
        WHERE session_id = $1
        ORDER BY created_at ASC
        LIMIT $2`,
				[session.id, parseInt(messageLimit)]
			);

			res.json({
				session,
				messages: messagesResult.rows,
			});
		} finally {
			client.release();
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

		const client = await pool.connect();
		try {
			const sessionUuid = uuidv4();

			const result = await client.query(
				`INSERT INTO chat_sessions 
        (account_id, session_uuid, title, model_type, ai_enabled)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id`,
				[req.user.id, sessionUuid, title || "New Chat", modelType, aiEnabled]
			);

			res.status(201).json({
				message: "Session created",
				session: {
					id: result.rows[0].id,
					session_uuid: sessionUuid,
					title: title || "New Chat",
					model_type: modelType,
					ai_enabled: aiEnabled,
				},
			});
		} finally {
			client.release();
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

		const client = await pool.connect();
		try {
			const sessionResult = await client.query("SELECT id FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2", [
				uuid,
				req.user.id,
			]);
			const session = sessionResult.rows[0];

			if (!session) {
				return res.status(404).json({ error: "Session not found" });
			}

			const result = await client.query(
				`INSERT INTO chat_messages 
        (session_id, role, content, tokens_used, response_time_ms)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id`,
				[session.id, role, content, tokensUsed, responseTimeMs]
			);

			// Update session
			await client.query(
				`UPDATE chat_sessions 
        SET message_count = message_count + 1, updated_at = NOW()
        WHERE id = $1`,
				[session.id]
			);

			// Auto-generate title from first user message
			const firstMessageResult = await client.query(
				`SELECT content FROM chat_messages 
        WHERE session_id = $1 AND role = 'user' 
        ORDER BY created_at ASC LIMIT 1`,
				[session.id]
			);
			const firstMessage = firstMessageResult.rows[0];

			if (firstMessage && role === "user") {
				const autoTitle = firstMessage.content.slice(0, 50) + (firstMessage.content.length > 50 ? "..." : "");
				await client.query("UPDATE chat_sessions SET title = $1 WHERE id = $2 AND title = $3", [
					autoTitle,
					session.id,
					"New Chat",
				]);
			}

			res.status(201).json({
				message: "Message added",
				messageId: result.rows[0].id,
			});
		} finally {
			client.release();
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

		const client = await pool.connect();
		try {
			const sessionResult = await client.query("SELECT id FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2", [
				uuid,
				req.user.id,
			]);
			const session = sessionResult.rows[0];

			if (!session) {
				return res.status(404).json({ error: "Session not found" });
			}

			const updates = [];
			const params = [];

			if (title !== undefined) {
				params.push(title);
				updates.push(`title = $${params.length}`);
			}
			if (modelType !== undefined) {
				if (!["tanka", "villanelle", "ode", "chemistry"].includes(modelType)) {
					return res.status(400).json({ error: "Invalid model type" });
				}
				params.push(modelType);
				updates.push(`model_type = $${params.length}`);
			}
			if (aiEnabled !== undefined) {
				params.push(aiEnabled);
				updates.push(`ai_enabled = $${params.length}`);
			}

			if (updates.length > 0) {
				params.push(session.id);
				await client.query(`UPDATE chat_sessions SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${params.length}`, params);
			}

			res.json({ message: "Session updated" });
		} finally {
			client.release();
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

		const client = await pool.connect();
		try {
			const sessionResult = await client.query("SELECT id FROM chat_sessions WHERE session_uuid = $1 AND account_id = $2", [
				uuid,
				req.user.id,
			]);
			const session = sessionResult.rows[0];

			if (!session) {
				return res.status(404).json({ error: "Session not found" });
			}

			// Soft delete
			await client.query("UPDATE chat_sessions SET is_active = FALSE, updated_at = NOW() WHERE id = $1", [session.id]);

			res.json({ message: "Session deleted" });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Delete session error:", error);
		res.status(500).json({ error: "Failed to delete session" });
	}
});

module.exports = router;
