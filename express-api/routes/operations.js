const express = require("express");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const GO_OPS_URL = process.env.GO_OPS_URL || "http://localhost:8083";
const GO_OPS_API_KEY = process.env.GO_OPS_API_KEY || "";

router.get("/health", async (req, res) => {
	try {
		const result = await fetch(`${GO_OPS_URL}/health`, {
			headers: { Accept: "application/json" },
		});
		if (!result.ok) {
			return res.status(502).json({ error: "Go ops service is unavailable" });
		}
		const data = await result.json();
		return res.json({ upstream: data });
	} catch (error) {
		console.error("Go ops health error:", error);
		return res.status(502).json({ error: "Failed to reach go ops service" });
	}
});

router.post("/events", authenticate, async (req, res) => {
	try {
		const eventType = String(req.body?.eventType || "").trim();
		if (!eventType) {
			return res.status(400).json({ error: "eventType is required" });
		}

		const payload = {
			eventType,
			source: "express",
			payload: {
				...req.body?.payload,
				accountId: req.user.id,
				at: new Date().toISOString(),
			},
		};

		const upstream = await fetch(`${GO_OPS_URL}/events/ingest`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-ops-key": GO_OPS_API_KEY,
			},
			body: JSON.stringify(payload),
		});

		if (!upstream.ok) {
			const detail = await upstream.text().catch(() => "");
			console.error("Go ops ingest error:", detail);
			return res.status(502).json({ error: "Failed to ingest operational event" });
		}

		const data = await upstream.json();
		return res.status(202).json({ accepted: true, upstream: data });
	} catch (error) {
		console.error("Operational event forwarding error:", error);
		return res.status(500).json({ error: "Operational event forwarding failed" });
	}
});

module.exports = router;
