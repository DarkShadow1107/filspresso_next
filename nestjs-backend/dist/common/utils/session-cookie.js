"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_COOKIE_NAME = void 0;
exports.setSessionCookie = setSessionCookie;
exports.clearSessionCookie = clearSessionCookie;
exports.readSessionToken = readSessionToken;
const auth_tokens_1 = require("./auth-tokens");
/**
 * Name of the browser session cookie. Kept distinct from the admin cookie so the
 * frontend proxy can forward exactly one cookie upstream.
 */
exports.SESSION_COOKIE_NAME = String(process.env.SESSION_COOKIE_NAME || "filspresso_session").trim() || "filspresso_session";
const DEFAULT_SESSION_COOKIE_SECONDS = Math.max(60, auth_tokens_1.AUTH_SESSION_IDLE_TIMEOUT_DAYS * 24 * 60 * 60);
/**
 * Decides the `Secure` attribute from the scheme the request actually arrived on
 * rather than from NODE_ENV, so a production build served over plain HTTP in
 * local development still issues a usable cookie. When TLS terminates at a proxy
 * (Caddy), the forwarded protocol header is the source of truth.
 */
function isCookieSecure(req) {
    const override = String(process.env.SESSION_COOKIE_SECURE || "").trim().toLowerCase();
    if (override === "true")
        return true;
    if (override === "false")
        return false;
    if (req?.headers?.["x-forwarded-proto"]) {
        const forwarded = String(req.headers["x-forwarded-proto"]).split(",")[0].trim().toLowerCase();
        return forwarded === "https";
    }
    return (req?.protocol || "").toLowerCase() === "https" || Boolean(req?.socket?.encrypted);
}
function baseCookieOptions(req) {
    return {
        // Not readable from JavaScript, so an XSS bug cannot exfiltrate the session.
        httpOnly: true,
        secure: isCookieSecure(req),
        sameSite: "lax",
        path: "/",
    };
}
function setSessionCookie(res, token, req, maxAgeSeconds) {
    const maxAge = Number.isFinite(maxAgeSeconds) && Number(maxAgeSeconds) > 0
        ? Math.floor(Number(maxAgeSeconds))
        : DEFAULT_SESSION_COOKIE_SECONDS;
    res.cookie(exports.SESSION_COOKIE_NAME, token, { ...baseCookieOptions(req), maxAge });
}
function clearSessionCookie(res, req) {
    res.clearCookie(exports.SESSION_COOKIE_NAME, baseCookieOptions(req));
}
/**
 * Reads a single cookie from the raw `Cookie` header.
 *
 * Express does not populate `req.cookies` unless `cookie-parser` is installed,
 * so the header is parsed here rather than adding a dependency to the auth path.
 * Malformed segments are ignored rather than throwing.
 */
function readCookieFromHeader(req, name) {
    const header = req.headers?.cookie;
    if (typeof header !== "string" || !header)
        return "";
    for (const part of header.split(";")) {
        const separator = part.indexOf("=");
        if (separator <= 0)
            continue;
        if (part.slice(0, separator).trim() !== name)
            continue;
        const value = part.slice(separator + 1).trim();
        try {
            return decodeURIComponent(value);
        }
        catch {
            return value;
        }
    }
    return "";
}
/**
 * Reads the session token from the request.
 *
 * The cookie is the primary transport; the Authorization header stays supported
 * so non-browser clients (CLI tooling, service-to-service calls) keep working.
 */
function readSessionToken(req) {
    const fromCookies = req.cookies?.[exports.SESSION_COOKIE_NAME];
    if (typeof fromCookies === "string" && fromCookies.trim()) {
        return fromCookies.trim();
    }
    const fromHeader = readCookieFromHeader(req, exports.SESSION_COOKIE_NAME);
    if (fromHeader)
        return fromHeader;
    const authHeader = String(req.headers?.authorization || "");
    if (authHeader.startsWith("Bearer ")) {
        const bearer = authHeader.slice(7).trim();
        if (bearer)
            return bearer;
    }
    return "";
}
