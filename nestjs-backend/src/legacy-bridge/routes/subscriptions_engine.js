const express = require("express");
const { authenticate } = require("../middleware/auth");
const { getEnvOrFile } = require("../utils/secrets");
const { issueServiceAssertion } = require("../utils/serviceAssertions");
const { assertAllowedEgress } = require("../utils/egressPolicy");
const { assertServiceContract } = require("../utils/serviceContracts");

const router = express.Router();
const KOTLIN_SUBS_URL = process.env.KOTLIN_SUBSCRIPTIONS_URL || "http://localhost:8084";
const KOTLIN_SUBS_REQUIRE_SERVICE_ASSERTION =
	String(process.env.KOTLIN_SUBSCRIPTIONS_REQUIRE_SERVICE_ASSERTION || "true")
		.trim()
		.toLowerCase() === "true";
const KOTLIN_SUBS_SERVICE_ASSERTION_SCOPE =
	String(process.env.KOTLIN_SUBSCRIPTIONS_SERVICE_ASSERTION_SCOPE || "service-subscriptions:quote").trim() ||
	"service-subscriptions:quote";
const SERVICE_ASSERTION_PRIVATE_KEY = getEnvOrFile("SERVICE_ASSERTION_PRIVATE_KEY", { required: false, defaultValue: "" });
const SERVICE_ASSERTION_ISSUER = String(process.env.SERVICE_ASSERTION_ISSUER || "filspresso-backend").trim();
const SERVICE_ASSERTION_SUBJECT = String(process.env.SERVICE_ASSERTION_SUBJECT || "backend").trim();
const SERVICE_ASSERTION_TTL_SECONDS = Math.min(
	Math.max(Number.parseInt(process.env.SERVICE_ASSERTION_TTL_SECONDS || "120", 10) || 120, 30),
	600,
);

assertAllowedEgress(KOTLIN_SUBS_URL, "KOTLIN_SUBSCRIPTIONS_URL");

function createSubscriptionServiceAssertionHeader() {
	if (!SERVICE_ASSERTION_PRIVATE_KEY) {
		return "";
	}

	try {
		const issued = issueServiceAssertion({
			privateKeyPem: SERVICE_ASSERTION_PRIVATE_KEY,
			issuer: SERVICE_ASSERTION_ISSUER,
			subject: SERVICE_ASSERTION_SUBJECT,
			scope: KOTLIN_SUBS_SERVICE_ASSERTION_SCOPE,
			ttlSeconds: SERVICE_ASSERTION_TTL_SECONDS,
		});
		return issued.token;
	} catch (error) {
		console.warn("Failed to issue subscription service assertion:", error.message || String(error));
		return "";
	}
}

function buildSubscriptionUpstreamHeaders(baseHeaders = {}) {
	const serviceAssertion = createSubscriptionServiceAssertionHeader();
	if (KOTLIN_SUBS_REQUIRE_SERVICE_ASSERTION && !serviceAssertion) {
		return null;
	}

	if (!serviceAssertion) {
		return baseHeaders;
	}

	return {
		...baseHeaders,
		"x-service-name": "filspresso-backend",
		"x-service-assertion": serviceAssertion,
	};
}

router.get("/health", async (req, res) => {
	try {
		const headers = buildSubscriptionUpstreamHeaders({ Accept: "application/json" });
		if (!headers) {
			return res.status(500).json({ error: "Subscription service assertion is required but could not be issued" });
		}

		const upstream = await fetch(`${KOTLIN_SUBS_URL}/api/subscriptions/health`, {
			headers,
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
		const headers = buildSubscriptionUpstreamHeaders({
			"Content-Type": "application/json",
			Accept: "application/json",
		});
		if (!headers) {
			return res.status(500).json({ error: "Subscription service assertion is required but could not be issued" });
		}

		const quoteRequestPayload = {
			tier: req.body?.tier,
			billingCycle: req.body?.billingCycle,
			currentTier: req.body?.currentTier || String(req.user.subscription || "free").toLowerCase(),
		};
		assertServiceContract("kotlin_quote_request_v1", quoteRequestPayload);

		const upstream = await fetch(`${KOTLIN_SUBS_URL}/api/subscriptions/quote`, {
			method: "POST",
			headers,
			body: JSON.stringify(quoteRequestPayload),
		});

		if (!upstream.ok) {
			const detail = await upstream.text().catch(() => "");
			console.error("Kotlin subscription quote error:", detail);
			return res.status(502).json({ error: "Subscription quote engine failed" });
		}

		const quote = await upstream.json();
		assertServiceContract("kotlin_quote_response_v1", { quote });
		return res.json({ quote });
	} catch (error) {
		console.error("Subscription quote forwarding error:", error);
		return res.status(500).json({ error: "Subscription quote failed" });
	}
});

module.exports = router;
