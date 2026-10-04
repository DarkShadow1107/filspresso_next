import type { Request, Response } from "express";
import { AUTH_SESSION_IDLE_TIMEOUT_DAYS } from "./auth-tokens";

/**
 * Name of the browser session cookie. Kept distinct from the admin cookie so the
 * frontend proxy can forward exactly one cookie upstream.
 */
export const SESSION_COOKIE_NAME = String(process.env.SESSION_COOKIE_NAME || "filspresso_session").trim() || "filspresso_session";

const DEFAULT_SESSION_COOKIE_SECONDS = Math.max(60, AUTH_SESSION_IDLE_TIMEOUT_DAYS * 24 * 60 * 60);

/**
 * Decides the `Secure` attribute from the scheme the request actually arrived on
 * rather than from NODE_ENV, so a production build served over plain HTTP in
 * local development still issues a usable cookie. When TLS terminates at a proxy
 * (Caddy), the forwarded protocol header is the source of truth.
 */
function isCookieSecure(req?: Request): boolean {
	const override = String(process.env.SESSION_COOKIE_SECURE || "").trim().toLowerCase();
	if (override === "true") return true;
	if (override === "false") return false;

	if (req?.headers?.["x-forwarded-proto"]) {
		const forwarded = String(req.headers["x-forwarded-proto"]).split(",")[0].trim().toLowerCase();
		return forwarded === "https";
	}

	return (req?.protocol || "").toLowerCase() === "https" || Boolean((req?.socket as { encrypted?: boolean } | undefined)?.encrypted);
}

function baseCookieOptions(req?: Request) {
	return {
		// Not readable from JavaScript, so an XSS bug cannot exfiltrate the session.
		httpOnly: true,
		secure: isCookieSecure(req),
		sameSite: "lax" as const,
		path: "/",
	};
}

export function setSessionCookie(res: Response, token: string, req?: Request, maxAgeSeconds?: number): void {
	const maxAge = Number.isFinite(maxAgeSeconds) && Number(maxAgeSeconds) > 0
		? Math.floor(Number(maxAgeSeconds))
		: DEFAULT_SESSION_COOKIE_SECONDS;

	res.cookie(SESSION_COOKIE_NAME, token, { ...baseCookieOptions(req), maxAge });
}

export function clearSessionCookie(res: Response, req?: Request): void {
	res.clearCookie(SESSION_COOKIE_NAME, baseCookieOptions(req));
}

/**
 * Reads a single cookie from the raw `Cookie` header.
 *
 * Express does not populate `req.cookies` unless `cookie-parser` is installed,
 * so the header is parsed here rather than adding a dependency to the auth path.
 * Malformed segments are ignored rather than throwing.
 */
function readCookieFromHeader(req: Request, name: string): string {
	const header = req.headers?.cookie;
	if (typeof header !== "string" || !header) return "";

	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator <= 0) continue;
		if (part.slice(0, separator).trim() !== name) continue;

		const value = part.slice(separator + 1).trim();
		try {
			return decodeURIComponent(value);
		} catch {
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
export function readSessionToken(req: Request): string {
	const fromCookies = req.cookies?.[SESSION_COOKIE_NAME];
	if (typeof fromCookies === "string" && fromCookies.trim()) {
		return fromCookies.trim();
	}

	const fromHeader = readCookieFromHeader(req, SESSION_COOKIE_NAME);
	if (fromHeader) return fromHeader;

	const authHeader = String(req.headers?.authorization || "");
	if (authHeader.startsWith("Bearer ")) {
		const bearer = authHeader.slice(7).trim();
		if (bearer) return bearer;
	}

	return "";
}
