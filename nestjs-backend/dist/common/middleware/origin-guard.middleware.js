"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.originGuardMiddleware = originGuardMiddleware;
const isProduction = process.env.NODE_ENV === "production";
const csrfRequireOriginForCookie = String(process.env.CSRF_REQUIRE_ORIGIN_FOR_COOKIE || "true")
    .trim()
    .toLowerCase() === "true";
const csrfEnforceFetchMetadata = String(process.env.CSRF_ENFORCE_FETCH_METADATA || "true")
    .trim()
    .toLowerCase() === "true";
const configuredOrigins = String(process.env.CORS_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
function allowLocalhostOrigin(origin) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
function isAllowedOrigin(origin) {
    if (!origin)
        return true;
    if (configuredOrigins.includes(origin))
        return true;
    if (!isProduction && allowLocalhostOrigin(origin))
        return true;
    return false;
}
function extractOriginFromReferer(referer) {
    if (!referer)
        return "";
    try {
        return new URL(referer).origin;
    }
    catch {
        return "";
    }
}
function shouldCheckCsrf(req) {
    const method = String(req.method || "GET").toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method))
        return false;
    const hasCookies = String(req.headers.cookie || "").length > 0;
    const hasAuthHeader = String(req.headers.authorization || "")
        .trim()
        .startsWith("Bearer ");
    return hasCookies || hasAuthHeader;
}
function hasCookies(req) {
    return String(req.headers.cookie || "").trim().length > 0;
}
function isCrossSiteFetch(req) {
    const fetchSite = String(req.headers["sec-fetch-site"] || "")
        .trim()
        .toLowerCase();
    return fetchSite === "cross-site";
}
function originGuardMiddleware(req, res, next) {
    if (!shouldCheckCsrf(req)) {
        next();
        return;
    }
    if (csrfEnforceFetchMetadata && hasCookies(req) && isCrossSiteFetch(req)) {
        res.status(403).json({
            error: "Origin check failed",
            reason: "Cross-site browser request blocked by fetch metadata policy",
            requestId: req.requestId,
        });
        return;
    }
    const origin = String(req.headers.origin || "").trim();
    const refererOrigin = extractOriginFromReferer(String(req.headers.referer || ""));
    const candidateOrigin = origin || refererOrigin;
    if (!candidateOrigin) {
        if (hasCookies(req) && csrfRequireOriginForCookie) {
            res.status(403).json({
                error: "Origin check failed",
                reason: "Missing Origin/Referer for cookie-authenticated state-changing request",
                requestId: req.requestId,
            });
            return;
        }
        next();
        return;
    }
    if (!isAllowedOrigin(candidateOrigin)) {
        res.status(403).json({
            error: "Origin check failed",
            reason: "Potential CSRF or cross-origin request blocked",
            requestId: req.requestId,
        });
        return;
    }
    next();
}
