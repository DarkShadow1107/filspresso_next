import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";

import {
	PER_ROUTE_RATE_LIMITS,
	GLOBAL_RATE_LIMIT_EXCLUDED_PATHS,
	isExcludedFromGlobalRateLimit,
	ruleFor,
	type PerRouteRateLimitName,
} from "../src/config/rate-limit.policy";
import { DEFAULT_API_RATE_LIMIT_MAX, DEFAULT_API_RATE_LIMIT_WINDOW_MS } from "../src/config/constants";

const NAMES = Object.keys(PER_ROUTE_RATE_LIMITS) as PerRouteRateLimitName[];

test("every route named in the Phase 4 plan has a rule", () => {
	// The plan lists these explicitly; if one is dropped the limit silently
	// reverts to the (much looser) global default.
	const required: PerRouteRateLimitName[] = [
		"POST /api/auth/login",
		"POST /api/auth/register",
		"POST /api/auth/mfa",
		"POST /api/admin/login",
		"POST /api/admin/mfa",
		"POST /api/orders",
		"POST /api/repairs",
		"GET /health/services",
		"GET /health/services/ledger/verify",
		"POST /api/crypto/mpc",
	];
	for (const name of required) {
		assert.ok(NAMES.includes(name), `missing rule for ${name}`);
	}
});

test("no override is less restrictive than the global default", () => {
	// The overrides exist because these routes are more sensitive than average.
	//
	// The invariant is on *rate*, not on limit and window separately: a raw window
	// comparison is wrong, because `register` deliberately allows 5 per hour over a
	// 60-minute window while the global is 1200 per 15 minutes. Comparing windows
	// alone would flag that as a loosening when the permitted rate is in fact 960x
	// lower. What must never happen is an override that permits more traffic than
	// the global default.
	const globalRatePerHour = (DEFAULT_API_RATE_LIMIT_MAX / DEFAULT_API_RATE_LIMIT_WINDOW_MS) * 3_600_000;
	for (const name of NAMES) {
		const rule = ruleFor(name);
		const ratePerHour = (rule.limit / rule.ttlMs) * 3_600_000;
		assert.ok(
			ratePerHour < globalRatePerHour,
			`${name} permits ${ratePerHour.toFixed(1)}/h, above the global ${globalRatePerHour.toFixed(1)}/h`,
		);
		assert.ok(
			rule.limit < DEFAULT_API_RATE_LIMIT_MAX,
			`${name} limit ${rule.limit} is not tighter than the global ${DEFAULT_API_RATE_LIMIT_MAX}`,
		);
	}
});

test("credential routes are the tightest group", () => {
	// Compared within the auth/admin family, since `orders` legitimately allows more
	// requests than a login. `register` is the exception: fewer total attempts, but
	// measured over a longer window.
	const credentialRoutes: PerRouteRateLimitName[] = [
		"POST /api/auth/login",
		"POST /api/auth/mfa",
		"POST /api/admin/login",
		"POST /api/admin/mfa",
	];
	const login = ruleFor("POST /api/auth/login");
	for (const name of credentialRoutes) {
		const rule = ruleFor(name);
		assert.ok(
			rule.limit <= login.limit,
			`${name} (${rule.limit}) is looser than login (${login.limit})`,
		);
	}
	// Registration is the most expensive to abuse, so it gets the fewest attempts.
	assert.ok(ruleFor("POST /api/auth/register").limit < login.limit);
});

test("every rule has a positive limit and a sane window", () => {
	for (const name of NAMES) {
		const rule = ruleFor(name);
		assert.ok(Number.isInteger(rule.limit) && rule.limit > 0, `${name} limit`);
		assert.ok(rule.ttlMs >= 1000, `${name} window must be at least a second`);
		assert.ok(rule.name.length > 0, `${name} needs a name for logs`);
	}
});

test("global exclusions match on path prefixes, not exact strings", () => {
	// Nest reports `/api/auth/login`, the policy stores `/auth/login`.
	assert.equal(isExcludedFromGlobalRateLimit("/api/auth/login"), true);
	assert.equal(isExcludedFromGlobalRateLimit("/auth/login"), true);
	// Prefix coverage, so every MFA sub-route is covered by one entry.
	assert.equal(isExcludedFromGlobalRateLimit("/api/auth/mfa/verify"), true);
	assert.equal(isExcludedFromGlobalRateLimit("/api/auth/mfa/setup"), true);
	// A sibling that merely starts with the same characters must not be excluded.
	assert.equal(isExcludedFromGlobalRateLimit("/api/auth/login-history"), false);
	// And unrelated routes are not excluded.
	assert.equal(isExcludedFromGlobalRateLimit("/api/orders"), false);
	assert.equal(isExcludedFromGlobalRateLimit("/health/services"), false);
});

test("every excluded auth/admin path still has its own tighter rule", () => {
	// The whole point of excluding them from the global limiter is that they are
	// governed by something stricter. Excluding without a rule would leave them
	// effectively unlimited.
	const ruleForPath: Record<string, PerRouteRateLimitName> = {
		"/auth/login": "POST /api/auth/login",
		"/auth/register": "POST /api/auth/register",
		"/auth/mfa": "POST /api/auth/mfa",
		"/admin/login": "POST /api/admin/login",
		"/admin/mfa": "POST /api/admin/mfa",
	};
	for (const excluded of GLOBAL_RATE_LIMIT_EXCLUDED_PATHS) {
		const ruleName = ruleForPath[excluded];
		if (!ruleName) continue; // Kafelot paths are quota-limited elsewhere.
		assert.ok(NAMES.includes(ruleName), `${excluded} is excluded but has no rule`);
	}
});