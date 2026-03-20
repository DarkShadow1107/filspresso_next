const express = require("express");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const KOTLIN_SUBS_URL = process.env.KOTLIN_SUBSCRIPTIONS_URL || "http://localhost:8084";

router.get("/health", async (req, res) => {
	try {
		const upstream = await fetch(`${KOTLIN_SUBS_URL}/api/subscriptions/health`, {
			headers: { Accept: "application/json" },
		});
		if (!upstream.ok) {
			return res.status(502).json({ error: "Kotlin subscription service unavailable" });
		}
		const data = await upstream.json();
		return res.json({ upstream: data });
	} catch (error) {
		console.error("Kotlin subscription health error:", error);
		return res.status(502).json({ error: "Failed to reach subscription engine" });
	}
});

router.post("/quote", authenticate, async (req, res) => {
	try {
		const upstream = await fetch(`${KOTLIN_SUBS_URL}/api/subscriptions/quote`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				tier: req.body?.tier,
				billingCycle: req.body?.billingCycle,
				currentTier: req.body?.currentTier || String(req.user.subscription || "free").toLowerCase(),
			}),
		});

		if (!upstream.ok) {
			const detail = await upstream.text().catch(() => "");
			console.error("Kotlin subscription quote error:", detail);
			return res.status(502).json({ error: "Subscription quote engine failed" });
		}

		const quote = await upstream.json();
		return res.json({ quote });
	} catch (error) {
		console.error("Subscription quote forwarding error:", error);
		return res.status(500).json({ error: "Subscription quote failed" });
	}
});

module.exports = router;
