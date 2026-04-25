const express = require("express");
const http = require("http");
const https = require("https");
const { authenticate } = require("../middleware/auth");
const { getEnvOrFile } = require("../utils/secrets");
const { issueServiceAssertion } = require("../utils/serviceAssertions");
const { assertAllowedEgress } = require("../utils/egressPolicy");
const { requireOperationReplayGuard } = require("../utils/replayGuard");
const { assertServiceContract } = require("../utils/serviceContracts");

const router = express.Router();
const GO_OPS_URL = process.env.GO_OPS_URL || "http://localhost:8083";
const GO_OPS_API_KEY = process.env.GO_OPS_API_KEY || "";
const GO_OPS_TIMEOUT_MS = Math.min(Math.max(Number.parseInt(process.env.GO_OPS_TIMEOUT_MS || "5000", 10) || 5000, 1000), 30000);
const GO_OPS_REQUIRE_TLS =
	String(process.env.GO_OPS_REQUIRE_TLS || "false")
		.trim()
		.toLowerCase() === "true";
const GO_OPS_REQUIRE_SERVICE_ASSERTION =
	String(process.env.GO_OPS_REQUIRE_SERVICE_ASSERTION || "true")
		.trim()
		.toLowerCase() === "true";
const GO_OPS_SERVICE_ASSERTION_SCOPE =
	String(process.env.GO_OPS_SERVICE_ASSERTION_SCOPE || "service-events:write").trim() || "service-events:write";
const GO_OPS_TLS_SERVERNAME = String(process.env.GO_OPS_TLS_SERVERNAME || "").trim();
const GO_OPS_CLIENT_CERT = getEnvOrFile("GO_OPS_CLIENT_CERT", { required: false, defaultValue: "" });
const GO_OPS_CLIENT_KEY = getEnvOrFile("GO_OPS_CLIENT_KEY", { required: false, defaultValue: "" });
const GO_OPS_CA_CERT = getEnvOrFile("GO_OPS_CA_CERT", { required: false, defaultValue: "" });
const SERVICE_ASSERTION_PRIVATE_KEY = getEnvOrFile("SERVICE_ASSERTION_PRIVATE_KEY", { required: false, defaultValue: "" });
const SERVICE_ASSERTION_ISSUER = String(process.env.SERVICE_ASSERTION_ISSUER || "filspresso-backend").trim();
const SERVICE_ASSERTION_SUBJECT = String(process.env.SERVICE_ASSERTION_SUBJECT || "backend").trim();
const SERVICE_ASSERTION_TTL_SECONDS = Math.min(
	Math.max(Number.parseInt(process.env.SERVICE_ASSERTION_TTL_SECONDS || "120", 10) || 120, 30),
	600,
);

assertAllowedEgress(GO_OPS_URL, "GO_OPS_URL");

let goOpsHttpsAgent;

function getGoOpsHttpsAgent() {
	if (!GO_OPS_CLIENT_CERT && !GO_OPS_CLIENT_KEY && !GO_OPS_CA_CERT) {
		return undefined;
	}

	if (!goOpsHttpsAgent) {
		goOpsHttpsAgent = new https.Agent({
			cert: GO_OPS_CLIENT_CERT || undefined,
			key: GO_OPS_CLIENT_KEY || undefined,
			ca: GO_OPS_CA_CERT || undefined,
			rejectUnauthorized: true,
			servername: GO_OPS_TLS_SERVERNAME || undefined,
			keepAlive: true,
		});
	}

	return goOpsHttpsAgent;
}

function createServiceAssertionHeader(operationId = "") {
	if (!SERVICE_ASSERTION_PRIVATE_KEY) {
		return "";
	}

	try {
		const issued = issueServiceAssertion({
			privateKeyPem: SERVICE_ASSERTION_PRIVATE_KEY,
			issuer: SERVICE_ASSERTION_ISSUER,
			subject: SERVICE_ASSERTION_SUBJECT,
			scope: GO_OPS_SERVICE_ASSERTION_SCOPE,
			ttlSeconds: SERVICE_ASSERTION_TTL_SECONDS,
			operationId,
			keyPurpose: "service_assertion_signing",
			operationType: "issue_service_assertion",
		});
		return issued.token;
	} catch (error) {
		console.warn("Failed to issue service assertion:", error.message || String(error));
		return "";
	}
}

function requestJson(targetUrl, options = {}) {
	const parsed = new URL(targetUrl);
	const isHttps = parsed.protocol === "https:";
	if (GO_OPS_REQUIRE_TLS && !isHttps) {
		throw new Error("GO_OPS_REQUIRE_TLS is true but GO_OPS_URL is not https");
	}

	const transport = isHttps ? https : http;
	const payload = options.body ? JSON.stringify(options.body) : null;
	const headers = {
		Accept: "application/json",
		...(options.headers || {}),
	};
	if (payload) {
		headers["Content-Type"] = "application/json";
		headers["Content-Length"] = Buffer.byteLength(payload);
	}

	return new Promise((resolve, reject) => {
		const requestOptions = {
			method: options.method || "GET",
			hostname: parsed.hostname,
			port: parsed.port || (isHttps ? 443 : 80),
			path: `${parsed.pathname}${parsed.search}`,
			headers,
			timeout: GO_OPS_TIMEOUT_MS,
		};

		if (isHttps) {
			const agent = getGoOpsHttpsAgent();
			if (agent) {
				requestOptions.agent = agent;
			}
		}

		const req = transport.request(requestOptions, (res) => {
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () => {
				const rawBody = Buffer.concat(chunks).toString("utf8");
				let parsedBody = null;
				if (rawBody) {
					try {
						parsedBody = JSON.parse(rawBody);
					} catch {
						parsedBody = rawBody;
					}
				}
				resolve({ status: res.statusCode || 0, body: parsedBody, rawBody });
			});
		});

		req.on("timeout", () => {
			req.destroy(new Error("go_ops request timed out"));
		});

		req.on("error", (error) => {
			reject(error);
		});

		if (payload) {
			req.write(payload);
		}

		req.end();
	});
}

router.get("/health", async (req, res) => {
	try {
		const result = await requestJson(`${GO_OPS_URL}/health`, { method: "GET" });
		if (result.status < 200 || result.status >= 300) {
			return res.status(502).json({ error: "Go ops service is unavailable" });
		}
		return res.json({ upstream: result.body });
	} catch (error) {
		console.error("Go ops health error:", error);
		return res.status(502).json({ error: "Failed to reach go ops service" });
	}
});

router.post("/events", authenticate, requireOperationReplayGuard({ scope: "ops-events", ttlSeconds: 900 }), async (req, res) => {
	try {
		const eventType = String(req.body?.eventType || "").trim();
		if (!eventType) {
			return res.status(400).json({ error: "eventType is required" });
		}

		const operationId = String(req.operationId || "").trim();

		const payload = {
			eventType,
			source: "express",
			operationId,
			payload: {
				...req.body?.payload,
				accountId: req.user.id,
				at: new Date().toISOString(),
				operationId,
			},
		};

		assertServiceContract("go_ops_event_ingest_v1", payload);

		const serviceAssertion = createServiceAssertionHeader(operationId);
		if (GO_OPS_REQUIRE_SERVICE_ASSERTION && !serviceAssertion) {
			return res.status(500).json({ error: "go_ops service assertion is required but could not be issued" });
		}

		const headers = {
			"x-service-name": "filspresso-backend",
			"x-operation-id": operationId,
		};
		if (GO_OPS_API_KEY) {
			headers["x-ops-key"] = GO_OPS_API_KEY;
		}
		if (serviceAssertion) {
			headers["x-service-assertion"] = serviceAssertion;
		}

		const upstream = await requestJson(`${GO_OPS_URL}/events/ingest`, {
			method: "POST",
			headers,
			body: payload,
		});

		if (upstream.status < 200 || upstream.status >= 300) {
			console.error("Go ops ingest error:", upstream.rawBody || upstream.body || "");
			return res.status(502).json({ error: "Failed to ingest operational event" });
		}

		return res.status(202).json({ accepted: true, operationId, upstream: upstream.body });
	} catch (error) {
		console.error("Operational event forwarding error:", error);
		return res.status(500).json({ error: "Operational event forwarding failed" });
	}
});

module.exports = router;
