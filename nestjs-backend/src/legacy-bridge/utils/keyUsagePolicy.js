const SERVICE_ASSERTION_ALLOWED_SCOPES = String(
	process.env.SERVICE_ASSERTION_ALLOWED_SCOPES ||
		"service-events:write,service-invoice:render,service-subscriptions:quote,service-crypto:commitment,service-crypto:verify,service-threshold:initiate,service-threshold:approve,service-threshold:execute",
)
	.split(",")
	.map((entry) => entry.trim())
	.filter(Boolean);

const DEFAULT_POLICIES = {
	service_assertion_signing: {
		operations: ["issue_service_assertion"],
		scopes: SERVICE_ASSERTION_ALLOWED_SCOPES,
	},
	user_identity_signing: {
		operations: ["issue_user_jwt"],
		scopes: ["access_token", "refresh_token"],
	},
};

function normalizeRuleSet(value) {
	if (value === "*") {
		return { wildcard: true, values: new Set() };
	}

	const list = Array.isArray(value) ? value : [];
	return {
		wildcard: false,
		values: new Set(list.map((entry) => String(entry || "").trim()).filter(Boolean)),
	};
}

function parseOverridePolicies() {
	const raw = String(process.env.KEY_USAGE_POLICY_JSON || "").trim();
	if (!raw) {
		return {};
	}

	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		return parsed;
	} catch {
		console.warn("KEY_USAGE_POLICY_JSON is invalid JSON; ignoring overrides");
		return {};
	}
}

function buildPolicies() {
	const overrides = parseOverridePolicies();
	const policyMap = {};

	const names = new Set([...Object.keys(DEFAULT_POLICIES), ...Object.keys(overrides)]);
	for (const name of names) {
		const fallback = DEFAULT_POLICIES[name] || {};
		const override = overrides[name] || {};

		const operations = override.operations !== undefined ? override.operations : fallback.operations;
		const scopes = override.scopes !== undefined ? override.scopes : fallback.scopes;

		policyMap[name] = {
			operations: normalizeRuleSet(operations),
			scopes: normalizeRuleSet(scopes),
		};
	}

	return policyMap;
}

const KEY_USAGE_POLICIES = buildPolicies();

function matchesRule(ruleSet, value) {
	if (ruleSet.wildcard) {
		return true;
	}

	if (ruleSet.values.size === 0) {
		return false;
	}

	return ruleSet.values.has(String(value || "").trim());
}

function assertKeyUsage(options = {}) {
	const keyPurpose = String(options.keyPurpose || "").trim();
	const operationType = String(options.operationType || "").trim();
	const requestedScope = String(options.requestedScope || "").trim();
	const keyId = String(options.keyId || "").trim() || "unknown";

	if (!keyPurpose) {
		throw new Error("keyPurpose is required for key usage policy checks");
	}

	if (!operationType) {
		throw new Error("operationType is required for key usage policy checks");
	}

	const policy = KEY_USAGE_POLICIES[keyPurpose];
	if (!policy) {
		throw new Error(`No key usage policy registered for ${keyPurpose}`);
	}

	if (!matchesRule(policy.operations, operationType)) {
		throw new Error(
			`Key usage denied for purpose=${keyPurpose}, operation=${operationType}, keyId=${keyId}: operation not allowed`,
		);
	}

	if (requestedScope && !matchesRule(policy.scopes, requestedScope)) {
		throw new Error(`Key usage denied for purpose=${keyPurpose}, scope=${requestedScope}, keyId=${keyId}: scope not allowed`);
	}

	return true;
}

module.exports = {
	assertKeyUsage,
	KEY_USAGE_POLICIES,
};
