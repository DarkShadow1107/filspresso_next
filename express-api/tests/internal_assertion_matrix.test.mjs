import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());

function read(relativePath) {
	return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function mustContain(content, snippets, filePath) {
	for (const snippet of snippets) {
		assert.equal(content.includes(snippet), true, `${filePath} missing required assertion snippet: ${snippet}`);
	}
}

test("internal outbound edges require service assertions by default", () => {
	const operations = read("routes/operations.js");
	mustContain(
		operations,
		['GO_OPS_REQUIRE_SERVICE_ASSERTION || "true"', "x-service-assertion", "createServiceAssertionHeader"],
		"routes/operations.js",
	);

	const orders = read("routes/orders.js");
	mustContain(
		orders,
		['INVOICE_REQUIRE_SERVICE_ASSERTION || "true"', "x-service-assertion", "createInvoiceServiceAssertionHeader"],
		"routes/orders.js",
	);

	const subscriptions = read("routes/subscriptions_engine.js");
	mustContain(
		subscriptions,
		[
			'KOTLIN_SUBSCRIPTIONS_REQUIRE_SERVICE_ASSERTION || "true"',
			"x-service-assertion",
			"createSubscriptionServiceAssertionHeader",
		],
		"routes/subscriptions_engine.js",
	);

	const cryptoRoute = read("routes/crypto.js");
	mustContain(
		cryptoRoute,
		['RUST_CRYPTO_REQUIRE_SERVICE_ASSERTION || "true"', "x-service-assertion", "buildRustCryptoUpstreamHeaders"],
		"routes/crypto.js",
	);
});

test("internal ingress edge enforces strict signed assertions", () => {
	const server = read("server.js");
	mustContain(
		server,
		[
			'INTERNAL_SERVICE_ASSERTION_STRICT || "true"',
			"if (INTERNAL_SERVICE_ASSERTION_STRICT && !assertionToken)",
			"requireJti: INTERNAL_SERVICE_ASSERTION_STRICT",
			"operation_id_mismatch",
		],
		"server.js",
	);
});
