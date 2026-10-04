"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLOBAL_RATE_LIMIT_EXCLUDED_PATHS = exports.PER_ROUTE_RATE_LIMITS = void 0;
exports.ruleFor = ruleFor;
exports.isExcludedFromGlobalRateLimit = isExcludedFromGlobalRateLimit;
const MINUTE = 60_000;
/**
 * Overrides keyed by the route they apply to.
 *
 * Auth routes are the priority: `login` is the one endpoint where a generous
 * limit is a real vulnerability, because it is the target of credential
 * stuffing.
 */
exports.PER_ROUTE_RATE_LIMITS = {
    "POST /api/auth/login": { limit: 10, ttlMs: 15 * MINUTE, name: "auth-login" },
    "POST /api/auth/register": { limit: 5, ttlMs: 60 * MINUTE, name: "auth-register" },
    "POST /api/auth/mfa": { limit: 10, ttlMs: 15 * MINUTE, name: "auth-mfa" },
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
};
function ruleFor(name) {
    return exports.PER_ROUTE_RATE_LIMITS[name];
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
exports.GLOBAL_RATE_LIMIT_EXCLUDED_PATHS = [
    "/auth/login",
    "/auth/register",
    "/auth/mfa",
    "/admin/login",
    "/admin/mfa",
    "/kafelot/check-and-use",
    "/kafelot/status",
];
/** True when `path` (e.g. `/api/auth/login`) is exempt from the global limiter. */
function isExcludedFromGlobalRateLimit(path) {
    const withoutPrefix = path.replace(/^\/api/, "");
    return exports.GLOBAL_RATE_LIMIT_EXCLUDED_PATHS.some((excluded) => withoutPrefix === excluded || withoutPrefix.startsWith(`${excluded}/`));
}
