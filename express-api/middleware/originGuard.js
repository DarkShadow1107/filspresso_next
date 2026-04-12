const IS_PRODUCTION = process.env.NODE_ENV === "production";
const CSRF_REQUIRE_ORIGIN_FOR_COOKIE =
	String(process.env.CSRF_REQUIRE_ORIGIN_FOR_COOKIE || "true")
		.trim()
		.toLowerCase() === "true";
const CSRF_ENFORCE_FETCH_METADATA =
	String(process.env.CSRF_ENFORCE_FETCH_METADATA || "true")
		.trim()
		.toLowerCase() === "true";

const configuredOrigins = String(process.env.CORS_ORIGIN || "http://localhost:3000")
	.split(",")
	.map((entry) => entry.trim())
	.filter(Boolean);

function allowLocalhostOrigin(origin) {
	if (!origin) return false;
	return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function isAllowedOrigin(origin) {
	if (!origin) return true;
	if (configuredOrigins.includes(origin)) return true;
	if (!IS_PRODUCTION && allowLocalhostOrigin(origin)) return true;
	return false;
}

function extractOriginFromReferer(referer) {
	if (!referer) return "";
	try {
		const parsed = new URL(referer);
		return parsed.origin;
	} catch {
		return "";
	}
}

function shouldCheckCsrf(req) {
	const method = String(req.method || "GET").toUpperCase();
	if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;

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

function originGuard(req, res, next) {
	if (!shouldCheckCsrf(req)) {
		return next();
	}

	if (CSRF_ENFORCE_FETCH_METADATA && hasCookies(req) && isCrossSiteFetch(req)) {
		return res.status(403).json({
			error: "Origin check failed",
			reason: "Cross-site browser request blocked by fetch metadata policy",
			requestId: req.requestId,
		});
	}

	const origin = String(req.headers.origin || "").trim();
	const refererOrigin = extractOriginFromReferer(String(req.headers.referer || ""));
	const candidateOrigin = origin || refererOrigin;

	if (!candidateOrigin) {
		if (hasCookies(req) && CSRF_REQUIRE_ORIGIN_FOR_COOKIE) {
			return res.status(403).json({
				error: "Origin check failed",
				reason: "Missing Origin/Referer for cookie-authenticated state-changing request",
				requestId: req.requestId,
			});
		}

		// Non-browser token clients often do not send Origin/Referer.
		return next();
	}

	if (!isAllowedOrigin(candidateOrigin)) {
		return res.status(403).json({
			error: "Origin check failed",
			reason: "Potential CSRF or cross-origin request blocked",
			requestId: req.requestId,
		});
	}

	return next();
}

module.exports = {
	originGuard,
};
