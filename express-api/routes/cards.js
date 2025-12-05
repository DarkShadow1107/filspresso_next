/**
 * User Cards Routes (Payment Methods)
 * GET /api/cards - Get user's cards
 * POST /api/cards - Add new card
 * PUT /api/cards/:id - Update card
 * DELETE /api/cards/:id - Delete card
 */

const express = require("express");
const pool = require("../db/connection");
const { authenticate } = require("../middleware/auth");
const { encrypt, decrypt, getLastFour, detectCardType } = require("../utils/encryption");

const router = express.Router();

/**
 * Get all cards for authenticated user
 */
router.get("/", authenticate, async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			const cardsRaw = await conn.query(
				`SELECT id, card_holder, card_type, card_last_four, card_expiry_encrypted, card_cvv_encrypted, is_default, created_at
        FROM user_cards WHERE account_id = ? ORDER BY is_default DESC, created_at DESC`,
				[req.user.id]
			);

			// Decrypt expiry and CVV for each card
			const cards = cardsRaw.map((card) => ({
				id: Number(card.id),
				card_holder: card.card_holder,
				card_type: card.card_type,
				card_last_four: card.card_last_four,
				card_expiry: decrypt(card.card_expiry_encrypted),
				card_cvv: card.card_cvv_encrypted ? decrypt(card.card_cvv_encrypted) : null,
				is_default: Boolean(card.is_default),
				created_at: card.created_at,
			}));

			res.json({ cards });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get cards error:", error);
		res.status(500).json({ error: "Failed to get cards" });
	}
});

/**
 * Add new card
 */
router.post("/", authenticate, async (req, res) => {
	try {
		const { cardNumber, expiry, cvv, cardHolder, isDefault } = req.body;

		// Validation
		if (!cardNumber || !expiry || !cardHolder) {
			return res.status(400).json({ error: "Card number, expiry, and card holder are required" });
		}

		const cleanedNumber = cardNumber.replace(/\D/g, "");
		if (cleanedNumber.length < 13 || cleanedNumber.length > 19) {
			return res.status(400).json({ error: "Invalid card number" });
		}

		const conn = await pool.getConnection();
		try {
			// If setting as default, unset other defaults
			if (isDefault) {
				await conn.query("UPDATE user_cards SET is_default = FALSE WHERE account_id = ?", [req.user.id]);
			}

			// Encrypt sensitive data including CVV
			const encryptedNumber = encrypt(cleanedNumber);
			const encryptedExpiry = encrypt(expiry);
			const encryptedCvv = cvv ? encrypt(cvv) : null;
			const lastFour = getLastFour(cleanedNumber);
			const cardType = detectCardType(cleanedNumber);

			const result = await conn.query(
				`INSERT INTO user_cards 
        (account_id, card_number_encrypted, card_expiry_encrypted, card_cvv_encrypted,
            card_holder, card_type, card_last_four, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[req.user.id, encryptedNumber, encryptedExpiry, encryptedCvv, cardHolder, cardType, lastFour, isDefault || false]
			);

			const cardId = Number(result.insertId);

			res.status(201).json({
				message: "Card added successfully",
				card: {
					id: cardId,
					card_holder: cardHolder,
					card_type: cardType,
					card_last_four: lastFour,
					is_default: isDefault || false,
				},
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Add card error:", error);
		res.status(500).json({ error: "Failed to add card" });
	}
});

/**
 * Update card (set as default, update holder name)
 */
router.put("/:id", authenticate, async (req, res) => {
	try {
		const cardId = parseInt(req.params.id);
		const { cardHolder, isDefault } = req.body;

		const conn = await pool.getConnection();
		try {
			// Verify ownership
			const [card] = await conn.query("SELECT id FROM user_cards WHERE id = ? AND account_id = ?", [cardId, req.user.id]);

			if (!card) {
				return res.status(404).json({ error: "Card not found" });
			}

			// If setting as default, unset other defaults
			if (isDefault) {
				await conn.query("UPDATE user_cards SET is_default = FALSE WHERE account_id = ?", [req.user.id]);
			}

			const updates = [];
			const params = [];

			if (cardHolder !== undefined) {
				updates.push("card_holder = ?");
				params.push(cardHolder);
			}
			if (isDefault !== undefined) {
				updates.push("is_default = ?");
				params.push(isDefault);
			}

			if (updates.length > 0) {
				params.push(cardId);
				await conn.query(`UPDATE user_cards SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`, params);
			}

			res.json({ message: "Card updated successfully" });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Update card error:", error);
		res.status(500).json({ error: "Failed to update card" });
	}
});

/**
 * Delete card
 */
router.delete("/:id", authenticate, async (req, res) => {
	try {
		const cardId = parseInt(req.params.id);

		const conn = await pool.getConnection();
		try {
			// Verify ownership
			const [card] = await conn.query("SELECT id FROM user_cards WHERE id = ? AND account_id = ?", [cardId, req.user.id]);

			if (!card) {
				return res.status(404).json({ error: "Card not found" });
			}

			await conn.query("DELETE FROM user_cards WHERE id = ?", [cardId]);

			res.json({ message: "Card deleted successfully" });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Delete card error:", error);
		res.status(500).json({ error: "Failed to delete card" });
	}
});

module.exports = router;
