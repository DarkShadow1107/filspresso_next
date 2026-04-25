const { assertAllowedEgress } = require("../utils/egressPolicy");

const OPA_URL = String(process.env.OPA_URL || "").trim();
const OPA_TIMEOUT_MS = Math.min(Math.max(Number.parseInt(process.env.OPA_TIMEOUT_MS || "1500", 10) || 1500, 250), 10000);
const OPA_FAIL_CLOSED =
	String(process.env.OPA_FAIL_CLOSED || "false")
		.trim()
		.toLowerCase() === "true";

assertAllowedEgress(OPA_URL, "OPA_URL", { allowEmpty: true });

function getRequestIp(req) {
	const forwarded = String(req.headers["x-forwarded-for"] || "")
		.split(",")[0]
		.trim();
	return forwarded || String(req.headers["x-real-ip"] || "").trim() || req.ip || req.socket?.remoteAddress || null;
}

function normalizePath(req) {
	const raw = String(req.originalUrl || req.url || "");
	return raw.split("?")[0] || "/";
}

function buildIdentity(req) {
	if (req.serviceIdentity && typeof req.serviceIdentity === "object") {
		return {
			actor_type: req.serviceIdentity.actor_type || "service",
			service_name: req.serviceIdentity.service_name || null,
			role: req.serviceIdentity.role || "service",
		};
	}

	if (req.adminSession) {
		return {
			actor_type: "admin-user",
			account_id: req.adminSession.userId || null,
			username: req.adminSession.username || null,
			role: "admin",
		};
	}

	if (req.user) {
		return {
			actor_type: "user",
			account_id: req.user.id || null,
			username: req.user.username || null,
			role: req.user.role || "user",
		};
	}

	const serviceName = String(req.headers["x-service-name"] || "").trim();
	if (serviceName) {
		return {
			actor_type: "service",
			service_name: serviceName.slice(0, 128),
			role: "service",
		};
	}

	return {
		actor_type: "anonymous",
		role: "anonymous",
	};
}

async function evaluatePolicy(input) {
	if (!OPA_URL) {
		return { allow: true, reason: "opa_disabled" };
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), OPA_TIMEOUT_MS);

	try {
		const response = await fetch(OPA_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ input }),
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`OPA returned ${response.status}`);
		}

		const data = await response.json();
		const result = data?.result;
		if (typeof result === "boolean") {
			return { allow: result, reason: "opa_boolean_result" };
		}
		if (result && typeof result === "object") {
			return {
				allow: Boolean(result.allow),
				reason: String(result.reason || "opa_object_result"),
			};
		}
		return { allow: false, reason: "opa_invalid_result" };
	} catch (error) {
		if (!OPA_FAIL_CLOSED) {
			return {
				allow: true,
				reason: `opa_error_fail_open:${error.message || String(error)}`,
			};
		}
		return {
			allow: false,
			reason: `opa_error_fail_closed:${error.message || String(error)}`,
		};
	} finally {
		clearTimeout(timeout);
	}
}

function requirePolicyDecision(context = {}) {
	return async (req, res, next) => {
		const input = {
			resource: context.resource || "api",
			action: context.action || String(req.method || "GET").toLowerCase(),
			method: String(req.method || "GET").toUpperCase(),
			path: normalizePath(req),
			ip_address: getRequestIp(req),
			request_id: req.requestId || null,
			identity: buildIdentity(req),
		};

		const decision = await evaluatePolicy(input);
		if (!decision.allow) {
			return res.status(403).json({ error: "Policy denied request", reason: decision.reason, requestId: req.requestId });
		}

		next();
	};
}

module.exports = {
	requirePolicyDecision,
};
