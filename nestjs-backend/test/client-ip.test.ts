import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { normalizeIp, resolveClientIp } from "../src/common/utils/client-ip";

const { describe, it } = test;

const SRC = path.resolve(__dirname, "..", "src");

/** A request shaped like the ones Express hands a controller. `ip` is what Express resolved. */
function fakeRequest(overrides: Record<string, unknown> = {}) {
	return {
		ip: "203.0.113.9",
		socket: { remoteAddress: "172.20.0.1" },
		headers: {},
		...overrides,
	} as never;
}

describe("resolveClientIp", () => {
	it("uses the address Express resolved, not a client-supplied header", () => {
		// The whole point. A caller can send anything in the header; `req.ip` is what
		// Express computed by walking x-forwarded-for for exactly `trust proxy` hops.
		const req = fakeRequest({
			headers: { "x-forwarded-for": "10.0.0.1, 203.0.113.9", "x-real-ip": "10.0.0.1" },
		});
		assert.equal(resolveClientIp(req), "203.0.113.9");
	});

	it("ignores a forged header entirely", () => {
		// Before the fix this returned 127.0.0.1 and, in the admin service, satisfied an
		// ADMIN_IP_ALLOWLIST entry.
		const req = fakeRequest({
			ip: "198.51.100.4",
			headers: { "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1", "cf-connecting-ip": "127.0.0.1" },
		});
		assert.equal(resolveClientIp(req), "198.51.100.4");
	});

	it("falls back to the socket when Express produced nothing", () => {
		const req = fakeRequest({ ip: "", socket: { remoteAddress: "172.20.0.5" }, headers: { "x-forwarded-for": "1.2.3.4" } });
		assert.equal(resolveClientIp(req), "172.20.0.5");
	});

	it("returns an empty string rather than undefined when nothing is known", () => {
		// Callers compare against "" or null; an undefined here would read as "no IP"
		// in some places and crash in others.
		const req = fakeRequest({ ip: undefined, socket: {}, headers: {} });
		assert.equal(resolveClientIp(req), "");
	});
});

describe("normalizeIp", () => {
	it("strips the IPv4-mapped IPv6 prefix so allowlists compare equal", () => {
		assert.equal(normalizeIp("::ffff:203.0.113.9"), "203.0.113.9");
	});

	it("strips brackets from a bracketed IPv6 literal", () => {
		assert.equal(normalizeIp("[2001:db8::1]"), "2001:db8::1");
	});

	it("takes only the first entry of a chain", () => {
		assert.equal(normalizeIp("203.0.113.9, 10.0.0.1"), "203.0.113.9");
	});

	it("is idempotent, so an allowlist entry and a request normalize the same way", () => {
		const once = normalizeIp("::ffff:203.0.113.9");
		assert.equal(normalizeIp(once), once);
	});

	it("bounds the length", () => {
		assert.ok(normalizeIp("x".repeat(500)).length <= 64);
	});
});

describe("the four call sites no longer trust a proxy header", () => {
	const sites: Array<[string, string]> = [
		["admin/admin.service.ts", "ADMIN_IP_ALLOWLIST"],
		["auth/auth-complex.service.ts", "login lockout"],
		["common/guards/policy.guard.ts", "OPA input"],
		["weather/weather.controller.ts", "weather label"],
	];

	for (const [file, purpose] of sites) {
		it(`${file} (${purpose}) resolves through the shared helper`, () => {
			const src = readFileSync(path.join(SRC, file), "utf8");
			assert.match(src, /resolveClientIp|req\.ip/, `${file} must not read the header itself`);
			// A live read of the header, outside a comment, is the thing being removed.
			const live = src
				.split("\n")
				.filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
				.join("\n");
			assert.doesNotMatch(
				live,
				/headers\[["']x-forwarded-for["']\]/,
				`${file} still indexes x-forwarded-for directly`,
			);
		});
	}
});

describe("the admin allowlist cannot be satisfied by a forged header", () => {
	it("compares against the resolved address only", () => {
		const src = readFileSync(path.join(SRC, "admin/admin.service.ts"), "utf8");
		const start = src.indexOf("private isIpAllowed");
		assert.notEqual(start, -1, "isIpAllowed not found");
		const body = src.slice(start, src.indexOf("}", start));
		// The allowlist is the control; it must read the resolved address and nothing else.
		assert.match(body, /normalizeIp\(ip\)/);
		assert.doesNotMatch(body, /headers\[/, "the allowlist must not consult request headers");
	});

	it("still fails open when the allowlist is empty, as before", () => {
		// Unchanged behaviour, asserted so the refactor cannot quietly invert it: an
		// empty allowlist means "no restriction", not "deny everything".
		const src = readFileSync(path.join(SRC, "admin/admin.service.ts"), "utf8");
		assert.match(src, /if \(ADMIN_IP_ALLOWLIST\.length === 0\) return true;/);
	});
});

describe("the login lockout key no longer moves with a spoofed header", () => {
	/**
	 * Strip comments before a negative assertion.
	 *
	 * These functions carry a comment explaining that they *used* to read the header, so
	 * asserting on the raw text always trips over its own explanation. Only a `//` that
	 * appears before any quote on the line starts a comment -- otherwise the backticks
	 * around `x-forwarded-for` in the prose look like an unterminated string and the
	 * whole line is left alone.
	 */
	function live(body: string): string {
		return body
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.split("\n")
			.map((line) => {
				const slash = line.indexOf("//");
				if (slash === -1) return line;
				const firstQuote = line.search(/["'`]/);
				return firstQuote !== -1 && firstQuote < slash ? line : line.slice(0, slash);
			})
			.join("\n");
	}

	it("derives the client IP through the helper", () => {
		const src = readFileSync(path.join(SRC, "auth/auth-complex.service.ts"), "utf8");
		const start = src.indexOf("private getClientIp");
		assert.notEqual(start, -1, "getClientIp not found");
		const body = live(src.slice(start, src.indexOf("\n  }", start)));
		assert.match(body, /resolveClientIp/);
		assert.doesNotMatch(body, /x-forwarded-for|x-real-ip/, "the lockout IP must not come from a header");
	});

	it("still mixes the IP into the key, so it is not a username-only lockout", () => {
		// Recorded deliberately: the key is sha256(username|ip), so an attacker who
		// genuinely rotates source addresses still gets fresh buckets. That is a design
		// property, not an oversight, and the header spoof that made it trivial is gone.
		const src = readFileSync(path.join(SRC, "auth/auth-complex.service.ts"), "utf8");
		const start = src.indexOf("private computeLoginAttemptKey");
		const body = live(src.slice(start, src.indexOf("\n  }", start)));
		assert.match(body, /normalizedLoginKey.*normalizedIp/s);
	});
});
