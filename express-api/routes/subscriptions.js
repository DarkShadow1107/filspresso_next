/**
 * Subscriptions Routes
 * GET /api/subscriptions - Get user's subscription (current + scheduled)
 * POST /api/subscriptions - Create/update subscription
 * POST /api/subscriptions/change - Schedule a plan change
 * PUT /api/subscriptions/cancel - Cancel subscription
 */

const express = require("express");
const pool = require("../db/connection");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// Subscription pricing (matching SubscriptionPageContent.tsx)
const SUBSCRIPTION_PRICES = {
	free: { monthly: 0, annual: 0 },
	basic: { monthly: 55.99, annual: 399.99 },
	plus: { monthly: 109.99, annual: 1099.99 },
	pro: { monthly: 169.99, annual: 1699.99 },
	max: { monthly: 279.99, annual: 2699.99 },
	ultimate: { monthly: 599.99, annual: 6299.99 },
};

// Tier levels for comparison
const TIER_LEVELS = {
	free: 0,
	basic: 1,
	plus: 2,
	pro: 3,
	max: 4,
	ultimate: 5,
};

/**
 * Calculate renewal date based on billing cycle
 */
function calculateRenewalDate(billingCycle, fromDate = new Date()) {
	const date = new Date(fromDate);
	if (billingCycle === "annual") {
		date.setFullYear(date.getFullYear() + 1);
	} else {
		date.setMonth(date.getMonth() + 1);
	}
	return date.toISOString().split("T")[0];
}

/**
 * Get user's subscriptions (active/ending and scheduled)
 */
router.get("/", authenticate, async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			// Get current active or ending subscription
			const [currentSub] = await conn.query(
				`SELECT us.id, us.subscription_tier, us.billing_cycle, us.price_ron, 
                        us.start_date, us.renewal_date, us.end_date, us.is_active, us.auto_renew, us.status,
                        us.card_id, uc.card_last_four, uc.card_type
                 FROM user_subscriptions us
                 LEFT JOIN user_cards uc ON us.card_id = uc.id
                 WHERE us.account_id = ? AND us.is_active = TRUE AND us.status IN ('active', 'ending')
                 ORDER BY us.created_at DESC
                 LIMIT 1`,
				[req.user.id]
			);

			// Get scheduled subscription (if any)
			const [scheduledSub] = await conn.query(
				`SELECT us.id, us.subscription_tier, us.billing_cycle, us.price_ron, 
                        us.start_date, us.renewal_date, us.is_active, us.status,
                        us.card_id, uc.card_last_four, uc.card_type
                 FROM user_subscriptions us
                 LEFT JOIN user_cards uc ON us.card_id = uc.id
                 WHERE us.account_id = ? AND us.status = 'scheduled'
                 ORDER BY us.start_date ASC
                 LIMIT 1`,
				[req.user.id]
			);

			if (!currentSub) {
				// Return default free subscription
				return res.json({
					subscription: {
						tier: "free",
						billing_cycle: null,
						price_ron: 0,
						start_date: null,
						renewal_date: null,
						end_date: null,
						is_active: true,
						auto_renew: false,
						status: "active",
						card: null,
					},
					scheduled: null,
				});
			}

			const response = {
				subscription: {
					id: currentSub.id,
					tier: currentSub.subscription_tier,
					billing_cycle: currentSub.billing_cycle,
					price_ron: Number(currentSub.price_ron),
					start_date: currentSub.start_date,
					renewal_date: currentSub.renewal_date,
					end_date: currentSub.end_date,
					is_active: currentSub.is_active,
					auto_renew: currentSub.auto_renew,
					status: currentSub.status,
					card: currentSub.card_id
						? {
								id: currentSub.card_id,
								last_four: currentSub.card_last_four,
								type: currentSub.card_type,
						  }
						: null,
				},
				scheduled: scheduledSub
					? {
							id: scheduledSub.id,
							tier: scheduledSub.subscription_tier,
							billing_cycle: scheduledSub.billing_cycle,
							price_ron: Number(scheduledSub.price_ron),
							start_date: scheduledSub.start_date,
							renewal_date: scheduledSub.renewal_date,
							status: scheduledSub.status,
							card: scheduledSub.card_id
								? {
										id: scheduledSub.card_id,
										last_four: scheduledSub.card_last_four,
										type: scheduledSub.card_type,
								  }
								: null,
					  }
					: null,
			};

			res.json(response);
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get subscription error:", error);
		res.status(500).json({ error: "Failed to get subscription" });
	}
});

/**
 * Create or update subscription (for new users or first subscription)
 */
router.post("/", authenticate, async (req, res) => {
	try {
		const { tier, billingCycle, cardId } = req.body;

		if (!tier || !["free", "basic", "plus", "pro", "max", "ultimate"].includes(tier)) {
			return res.status(400).json({ error: "Invalid subscription tier" });
		}

		if (tier !== "free" && !["monthly", "annual"].includes(billingCycle)) {
			return res.status(400).json({ error: "Invalid billing cycle" });
		}

		const price = tier === "free" ? 0 : SUBSCRIPTION_PRICES[tier][billingCycle];
		const startDate = new Date().toISOString().split("T")[0];
		const renewalDate = tier === "free" ? null : calculateRenewalDate(billingCycle);

		const conn = await pool.getConnection();
		try {
			await conn.beginTransaction();

			// Deactivate any existing subscriptions and remove scheduled ones
			await conn.query("UPDATE user_subscriptions SET is_active = FALSE, status = 'cancelled' WHERE account_id = ?", [
				req.user.id,
			]);

			// Create new subscription
			const result = await conn.query(
				`INSERT INTO user_subscriptions 
                 (account_id, subscription_tier, billing_cycle, price_ron, 
                  start_date, renewal_date, is_active, auto_renew, status, card_id)
                 VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, 'active', ?)`,
				[req.user.id, tier, billingCycle || "monthly", price, startDate, renewalDate, tier !== "free", cardId || null]
			);

			// Update account subscription field
			await conn.query("UPDATE accounts SET subscription = ? WHERE id = ?", [
				tier.charAt(0).toUpperCase() + tier.slice(1),
				req.user.id,
			]);

			await conn.commit();

			res.status(201).json({
				message: "Subscription created successfully",
				subscription: {
					id: Number(result.insertId),
					tier,
					billing_cycle: billingCycle,
					price_ron: price,
					start_date: startDate,
					renewal_date: renewalDate,
					is_active: true,
					auto_renew: tier !== "free",
					status: "active",
				},
			});
		} catch (error) {
			await conn.rollback();
			throw error;
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Create subscription error:", error);
		res.status(500).json({ error: "Failed to create subscription" });
	}
});

/**
 * Schedule a plan change (keeps current subscription until it ends, then activates new one)
 */
router.post("/change", authenticate, async (req, res) => {
	try {
		const { tier, billingCycle, cardId } = req.body;

		if (!tier || !["basic", "plus", "pro", "max", "ultimate"].includes(tier)) {
			return res.status(400).json({ error: "Invalid subscription tier" });
		}

		if (!["monthly", "annual"].includes(billingCycle)) {
			return res.status(400).json({ error: "Invalid billing cycle" });
		}

		const conn = await pool.getConnection();
		try {
			await conn.beginTransaction();

			// Get current active subscription
			const [currentSub] = await conn.query(
				`SELECT id, subscription_tier, renewal_date, card_id FROM user_subscriptions 
				 WHERE account_id = ? AND is_active = TRUE AND status IN ('active', 'ending')
				 LIMIT 1`,
				[req.user.id]
			);

			if (!currentSub) {
				await conn.rollback();
				return res.status(400).json({ error: "No active subscription to change from" });
			}

			const currentTierLevel = TIER_LEVELS[currentSub.subscription_tier] || 0;
			const newTierLevel = TIER_LEVELS[tier] || 0;
			const isUpgrade = newTierLevel > currentTierLevel;

			// Remove any existing scheduled subscriptions
			await conn.query(`DELETE FROM user_subscriptions WHERE account_id = ? AND status = 'scheduled'`, [req.user.id]);

			const price = SUBSCRIPTION_PRICES[tier][billingCycle];
			const useCardId = cardId || currentSub.card_id;

			if (isUpgrade) {
				// For upgrades: activate immediately
				// Mark current as ending now
				await conn.query(
					`UPDATE user_subscriptions SET status = 'ending', end_date = CURDATE(), auto_renew = FALSE, is_active = FALSE
					 WHERE id = ?`,
					[currentSub.id]
				);

				const startDate = new Date().toISOString().split("T")[0];
				const renewalDate = calculateRenewalDate(billingCycle);

				// Create new active subscription
				const result = await conn.query(
					`INSERT INTO user_subscriptions 
					 (account_id, subscription_tier, billing_cycle, price_ron, 
					  start_date, renewal_date, is_active, auto_renew, status, card_id)
					 VALUES (?, ?, ?, ?, ?, ?, TRUE, TRUE, 'active', ?)`,
					[req.user.id, tier, billingCycle, price, startDate, renewalDate, useCardId]
				);

				// Update account subscription field
				await conn.query("UPDATE accounts SET subscription = ? WHERE id = ?", [
					tier.charAt(0).toUpperCase() + tier.slice(1),
					req.user.id,
				]);

				await conn.commit();

				res.status(201).json({
					message: "Subscription upgraded successfully! Your new plan is now active.",
					isUpgrade: true,
					subscription: {
						id: Number(result.insertId),
						tier,
						billing_cycle: billingCycle,
						price_ron: price,
						start_date: startDate,
						renewal_date: renewalDate,
						is_active: true,
						status: "active",
					},
				});
			} else {
				// For downgrades: schedule for when current subscription ends
				// Mark current as ending
				const endDate = currentSub.renewal_date;
				await conn.query(
					`UPDATE user_subscriptions SET status = 'ending', end_date = ?, auto_renew = FALSE
					 WHERE id = ?`,
					[endDate, currentSub.id]
				);

				// Create scheduled subscription starting when current ends
				const startDate = currentSub.renewal_date;
				const renewalDate = calculateRenewalDate(billingCycle, new Date(startDate));

				const result = await conn.query(
					`INSERT INTO user_subscriptions 
					 (account_id, subscription_tier, billing_cycle, price_ron, 
					  start_date, renewal_date, is_active, auto_renew, status, card_id)
					 VALUES (?, ?, ?, ?, ?, ?, FALSE, TRUE, 'scheduled', ?)`,
					[req.user.id, tier, billingCycle, price, startDate, renewalDate, useCardId]
				);

				await conn.commit();

				res.status(201).json({
					message: `Plan change scheduled. Your current plan continues until ${endDate}, then ${tier} will activate.`,
					isUpgrade: false,
					currentEnds: endDate,
					scheduled: {
						id: Number(result.insertId),
						tier,
						billing_cycle: billingCycle,
						price_ron: price,
						start_date: startDate,
						renewal_date: renewalDate,
						status: "scheduled",
					},
				});
			}
		} catch (error) {
			await conn.rollback();
			throw error;
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Change subscription error:", error);
		res.status(500).json({ error: "Failed to change subscription" });
	}
});

/**
 * Cancel subscription
 */
router.put("/cancel", authenticate, async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			const [subscription] = await conn.query(
				`SELECT id FROM user_subscriptions 
                 WHERE account_id = ? AND is_active = TRUE`,
				[req.user.id]
			);

			if (!subscription) {
				return res.status(404).json({ error: "No active subscription found" });
			}

			await conn.query(
				`UPDATE user_subscriptions 
                 SET auto_renew = FALSE, updated_at = NOW() 
                 WHERE id = ?`,
				[subscription.id]
			);

			// Revert to free tier on account
			await conn.query("UPDATE accounts SET subscription = 'Free' WHERE id = ?", [req.user.id]);

			res.json({ message: "Subscription cancelled. Access continues until renewal date." });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Cancel subscription error:", error);
		res.status(500).json({ error: "Failed to cancel subscription" });
	}
});

/**
 * Update payment method for subscription
 */
router.put("/update-card", authenticate, async (req, res) => {
	try {
		const { cardId } = req.body;

		if (!cardId) {
			return res.status(400).json({ error: "Card ID is required" });
		}

		const conn = await pool.getConnection();
		try {
			// Verify the card belongs to the user
			const [card] = await conn.query("SELECT id FROM user_cards WHERE id = ? AND account_id = ?", [cardId, req.user.id]);

			if (!card) {
				return res.status(404).json({ error: "Card not found" });
			}

			// Update subscription with new card
			await conn.query(
				`UPDATE user_subscriptions 
				 SET card_id = ?, updated_at = NOW() 
				 WHERE account_id = ? AND is_active = TRUE`,
				[cardId, req.user.id]
			);

			res.json({ message: "Payment method updated successfully" });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Update card error:", error);
		res.status(500).json({ error: "Failed to update payment method" });
	}
});

/**
 * Toggle auto-renew for subscription
 */
router.put("/toggle-auto-renew", authenticate, async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			const [subscription] = await conn.query(
				`SELECT id, auto_renew FROM user_subscriptions 
				 WHERE account_id = ? AND is_active = TRUE`,
				[req.user.id]
			);

			if (!subscription) {
				return res.status(404).json({ error: "No active subscription found" });
			}

			const newAutoRenew = !subscription.auto_renew;

			await conn.query(
				`UPDATE user_subscriptions 
				 SET auto_renew = ?, updated_at = NOW() 
				 WHERE id = ?`,
				[newAutoRenew, subscription.id]
			);

			res.json({
				message: newAutoRenew ? "Auto-renewal enabled" : "Auto-renewal disabled",
				auto_renew: newAutoRenew,
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Toggle auto-renew error:", error);
		res.status(500).json({ error: "Failed to toggle auto-renewal" });
	}
});

module.exports = router;
