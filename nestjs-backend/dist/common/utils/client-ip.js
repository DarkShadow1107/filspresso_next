"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveClientIp = resolveClientIp;
exports.normalizeIp = normalizeIp;
/**
 * The one place that decides what "the client's IP address" means.
 *
 * Four modules used to answer this independently, each reading `x-forwarded-for`
 * itself and each preferring it over the socket:
 *
 *   admin/admin.service.ts        gated the ADMIN_IP_ALLOWLIST
 *   auth/auth-complex.service.ts  keyed the escalating login lockout
 *   common/guards/policy.guard.ts supplied an OPA authorization input
 *   kafelot/kafelot.controller.ts attributed anonymous usage
 *
 * Every one of them was bypassable by a caller that simply set the header. For the
 * admin allowlist that meant "restrict admin access to these addresses" did not hold;
 * for the login lockout it meant rotating the header produced a fresh
 * `sha256(username|ip)` key on every attempt, so the lockout never engaged. Two copies
 * of the same rule that disagree is how it drifted, so there is now one.
 *
 * ## Why `req.ip`
 *
 * Express resolves `req.ip` according to the configured `trust proxy` (TRUST_PROXY,
 * default 1 in compose because Caddy is the only thing in front). It walks
 * `x-forwarded-for` right-to-left for exactly the number of trusted hops, which is what
 * makes the value trustworthy: it is the address the *trusted* hop observed, not a
 * string the caller supplied. Reading the header directly bypasses that decision
 * entirely, whatever `trust proxy` says.
 *
 * ## Residual risk, stated plainly
 *
 * `TRUST_PROXY=1` trusts exactly one hop. Caddy sets `x-forwarded-for` itself and
 * appends the address it saw, so the value it contributed is the real client and the
 * client-supplied prefix is ignored. But compose also publishes 4000 to the host, and a
 * caller reaching that port directly is itself "one hop" -- so they can set the header
 * and be believed. In development that is fine. In production, remove the port mapping
 * rather than setting TRUST_PROXY=0, which would break Caddy and re-break the per-IP
 * rate limiter along with it.
 */
function resolveClientIp(req) {
    const fromExpress = typeof req.ip === "string" ? req.ip.trim() : "";
    if (fromExpress)
        return normalizeIp(fromExpress);
    const socketAddress = typeof req.socket?.remoteAddress === "string" ? req.socket.remoteAddress : "";
    return normalizeIp(socketAddress);
}
/** Strip brackets and the IPv4-mapped IPv6 prefix, so allowlists compare equal. */
function normalizeIp(value) {
    let clean = String(value ?? "").split(",")[0].trim();
    clean = clean.replace(/^\[|\]$/g, "");
    if (clean.startsWith("::ffff:"))
        clean = clean.slice("::ffff:".length);
    return clean.slice(0, 64);
}
