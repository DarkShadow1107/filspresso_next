#!/usr/bin/env node

require("dotenv").config();

const { getEnvOrFile } = require("../utils/secrets");
const { issueServiceAssertion } = require("../utils/serviceAssertions");

function main() {
	const privateKeyPem = getEnvOrFile("SERVICE_ASSERTION_PRIVATE_KEY", { required: true });
	const issuer = String(process.argv[2] || process.env.SERVICE_ASSERTION_ISSUER || "filspresso-go-ops").trim();
	const subject = String(process.argv[3] || process.env.SERVICE_ASSERTION_SUBJECT || issuer).trim();
	const scope = String(process.argv[4] || process.env.SERVICE_ASSERTION_SCOPE || "service-events:write").trim();
	const ttlSecondsRaw = Number.parseInt(process.argv[5] || process.env.SERVICE_ASSERTION_TTL_SECONDS || "120", 10);
	const ttlSeconds = Number.isFinite(ttlSecondsRaw) ? ttlSecondsRaw : 120;

	const result = issueServiceAssertion({
		privateKeyPem,
		issuer,
		subject,
		scope,
		ttlSeconds,
	});

	console.log(JSON.stringify(result, null, 2));
}

try {
	main();
} catch (error) {
	console.error("Failed to issue service assertion:", error.message || String(error));
	process.exit(1);
}
