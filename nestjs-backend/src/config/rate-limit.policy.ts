/**
 * Rate-limit policy (PLAN_NESTJS_SCALING.md section 6, Phase 4).
 *
 * Two tiers:
 *
 * - A **global** default (`API_RATE_LIMIT_WINDOW_MS` / `API_RATE_LIMIT_MAX`) that
 *   every route inherits. Generous on purpose: it exists to stop runaway clients
 *   and scrapers, not to shape product behaviour.
 * - **Per-route overrides** for anything where the cost of abuse is asymmetric --
 *   credential endpoints, expensive writes, MPC. These are always *tighter* than
 *   the global default, so tightening the global value can never accidentally
 *   loosen a login route.
 *
 * The limits live here rather than inline on each handler so the whole policy is
 * reviewable in one place, and so a test can assert the invariants (every override
 * is stricter than the default) instead of trusting a dozen scattered decorators.
 */

export type RateLimitRule = {
	/** Requests allowed per window. */
	limit: number;
	/** Window length in milliseconds. */
	ttlMs: number;
	/** Human label used in logs and tests. */
	name: string;
};

const MINUTE = 60_000;

/**
 * Overrides keyed by the route they apply to.
 *
 * Auth routes are the priority: `login` is the one endpoint where a generous
 * limit is a real vulnerability, because it is the target of credential
 * stuffing.
 */
export const PER_ROUTE_RATE_LIMITS = {
	"POST /api/auth/login": { limit: 10, ttlMs: 15 * MINUTE, name: "auth-login" },
	"POST /api/auth/register": { limit: 5, ttlMs: 60 * MINUTE, name: "auth-register" },
	"POST /api/auth/mfa": { limit: 10, ttlMs: 15 * MINUTE, name: "auth-mfa" },
	// The desktop device grant.
	//
	// Tighter than the web login (6 vs 10) even though it is a rarer event, because this is
	// the route a script would drive: it is unauthenticated by definition and it is the one
	// that returns a usable long-lived credential. The escalating per-account lockout in
	// auth-complex.service.ts still backs it up; this is the cheap layer in front.
	//
	// The key is per account+device, not per IP -- see ThrottlerGuard's desktop key
	// derivation. That is the whole reason this is not simply another copy of the login
	// rule: the web limit is per IP, so an office behind one NAT shares it and a single
	// person's typo loop locks out everyone behind the same address.
	"POST /api/auth/desktop/token": { limit: 6, ttlMs: 15 * MINUTE, name: "auth-desktop-token" },
	// Refresh gets a deliberately separate and much looser budget. The access token lives
	// 15 minutes, so a desktop app legitimately refreshes several times an hour; folding
	// that into the grant's budget would log out every user with a long session, and
	// reusing the login budget would make a working app indistinguishable from a guessing
	// script. It is still a ceiling, because "unlimited" is not an option for a credential
	// endpoint.
	"POST /api/auth/desktop/refresh": { limit: 60, ttlMs: 15 * MINUTE, name: "auth-desktop-refresh" },
	"POST /api/admin/login": { limit: 10, ttlMs: 15 * MINUTE, name: "admin-login" },
	"POST /api/admin/mfa": { limit: 10, ttlMs: 15 * MINUTE, name: "admin-mfa" },
	"POST /api/orders": { limit: 20, ttlMs: 60 * MINUTE, name: "orders-create" },
	"POST /api/repairs": { limit: 20, ttlMs: 60 * MINUTE, name: "repairs-create" },
	"GET /health/services": { limit: 30, ttlMs: MINUTE, name: "health-services" },
	"GET /health/services/ledger/verify": {
		limit: 10,
		ttlMs: 5 * MINUTE,
		name: "ledger-verify",
	},
	"POST /api/crypto/mpc": { limit: 30, ttlMs: MINUTE, name: "crypto-mpc" },
} as const satisfies Record<string, RateLimitRule>;

export type PerRouteRateLimitName = keyof typeof PER_ROUTE_RATE_LIMITS;

/**
 * Environment override for one route's budget.
 *
 * Why these exist at all, given the literals above are the defaults. The policy was
 * environment-blind: a developer's machine and a production host got identical auth
 * budgets. That has two costs, and the second one bit us.
 *
 * The first is that the numbers cannot be tuned without a code change and a deploy, for a
 * control that is by nature an operational dial.
 *
 * The second is worse: running the full live-check suite repeatedly exhausted the *production*
 * register budget -- 5 per hour per IP -- on a developer machine, and the suite then failed
 * on "can register through the trusted proxy path (HTTP 429)". The failure looked like a
 * regression in the code under test and was not one. A rate limiter that makes its own test
 * suite unrunnable is miscalibrated, not strict.
 *
 * Each override is read only when present, so a deployment that sets nothing keeps exactly
 * the numbers above. Naming is per route, so an operator can loosen one budget without
 * touching another -- `RATE_LIMIT_POST__API__AUTH__LOGIN=30`.
 */
function envRule(route: string, fallback: RateLimitRule): RateLimitRule {
  // `+` rather than a single-character class, so a run of separators collapses to one
  // underscore. Without it "POST /api/auth/register" folds to `POST__API_AUTH_REGISTER` --
  // a double underscore after POST, because the space and the slash are adjacent -- and that
  // name is a trap to type. An operator who guesses wrong gets the production number with no
  // warning at all, which is the worst failure mode an override can have.
  //
  // The rule, in full: take the route, uppercase it, replace every run of non-alphanumeric
  // characters with one underscore, and prefix with RATE_LIMIT_. So
  // "POST /api/auth/register" becomes RATE_LIMIT_POST_API_AUTH_REGISTER_LIMIT, plus
  // _LIMIT and _WINDOW_MS.
  const key = `RATE_LIMIT_${route.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
  const rawLimit = (process.env[`${key}_LIMIT`] || "").trim();
  const rawWindow = (process.env[`${key}_WINDOW_MS`] || "").trim();
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : Number.NaN;
  const windowMs = rawWindow ? Number.parseInt(rawWindow, 10) : Number.NaN;

  if (Number.isNaN(limit) && Number.isNaN(windowMs)) return fallback;
  if (!Number.isNaN(limit) && limit <= 0) {
    throw new Error(`${key}_LIMIT must be a positive integer, got ${rawLimit}`);
  }
  if (!Number.isNaN(windowMs) && windowMs <= 0) {
    throw new Error(`${key}_WINDOW_MS must be a positive integer, got ${rawWindow}`);
  }
  return {
    limit: Number.isNaN(limit) ? fallback.limit : limit,
    ttlMs: Number.isNaN(windowMs) ? fallback.ttlMs : windowMs,
    name: fallback.name,
  };
}

/** The effective rule for a route: the literal, unless the environment overrides it. */
export function ruleFor(name: PerRouteRateLimitName): RateLimitRule {
  return envRule(String(name), PER_ROUTE_RATE_LIMITS[name]);
}

/**
 * Routes that are exempt from the *global* limiter.
 *
 * These are not unlimited: the auth and Kafelot routes carry their own tighter
 * per-route limits. Exempting them from the global counter only stops the broad
 * ceiling from consuming their budget before the specific rule is consulted.
 *
 * Paths are stored without the `/api` prefix because Nest reports the controller
 * path, and are matched as prefixes so `/auth/mfa/verify` is covered by
 * `/auth/mfa`.
 */
export const GLOBAL_RATE_LIMIT_EXCLUDED_PATHS: readonly string[] = [
	"/auth/login",
	"/auth/register",
	"/auth/mfa",
	"/admin/login",
	"/admin/mfa",
	"/kafelot/check-and-use",
	"/kafelot/status",
];

/** True when `path` (e.g. `/api/auth/login`) is exempt from the global limiter. */
export function isExcludedFromGlobalRateLimit(path: string): boolean {
	const withoutPrefix = path.replace(/^\/api/, "");
	return GLOBAL_RATE_LIMIT_EXCLUDED_PATHS.some(
		(excluded) => withoutPrefix === excluded || withoutPrefix.startsWith(`${excluded}/`),
	);
}