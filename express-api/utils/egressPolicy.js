const INTERNAL_EGRESS_ALLOWLIST = String(process.env.INTERNAL_EGRESS_ALLOWLIST || "")
	.split(",")
	.map((entry) => entry.trim().toLowerCase())
	.filter(Boolean);

function normalizeHost(hostname) {
	const raw = String(hostname || "")
		.trim()
		.toLowerCase();
	if (!raw) return "";
	if (raw.startsWith("[") && raw.endsWith("]")) {
		return raw.slice(1, -1);
	}
	return raw;
}

function matchesRule(host, rule) {
	if (!rule) return false;
	if (rule === host) return true;

	if (rule.startsWith("*.")) {
		const suffix = rule.slice(1); // keep leading dot for suffix match
		return host.endsWith(suffix);
	}

	return false;
}

function assertAllowedEgress(targetUrl, context = "egress", options = {}) {
	const allowEmpty = Boolean(options.allowEmpty);
	const urlText = String(targetUrl || "").trim();

	if (!urlText) {
		if (allowEmpty) return;
		throw new Error(`${context} URL is empty`);
	}

	if (INTERNAL_EGRESS_ALLOWLIST.length === 0) {
		return;
	}

	let parsed;
	try {
		parsed = new URL(urlText);
	} catch {
		throw new Error(`${context} URL is invalid: ${urlText}`);
	}

	const host = normalizeHost(parsed.hostname);
	const allowed = INTERNAL_EGRESS_ALLOWLIST.some((rule) => matchesRule(host, rule));
	if (!allowed) {
		throw new Error(`${context} host is not allowlisted: ${host}. Configure INTERNAL_EGRESS_ALLOWLIST to include this host.`);
	}
}

module.exports = {
	assertAllowedEgress,
};
