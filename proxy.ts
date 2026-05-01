import { NextResponse, type NextRequest } from "next/server";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const TRUSTED_TYPES_ENFORCE =
	String(process.env.NEXT_TRUSTED_TYPES_ENFORCE || (IS_PRODUCTION ? "true" : "false"))
		.trim()
		.toLowerCase() === "true";

const supportedSlugs = new Set([
	"home",
	"account",
	"coffee",
	"coffee-machine-animation",
	"love-coffee",
	"machines",
	"payment",
	"shopping-bag",
	"subscription",
]);

function shouldBypass(pathname: string) {
	return (
		pathname === "/" ||
		pathname === "" ||
		pathname.startsWith("/_next") ||
		pathname.startsWith("/api/") ||
		pathname.startsWith("/legacy/") ||
		pathname.startsWith("/images/") ||
		pathname.startsWith("/fonts/") ||
		pathname.startsWith("/favicon") ||
		pathname === "/robots.txt" ||
		pathname === "/sitemap.xml"
	);
}

function isHtmlNavigation(request: NextRequest) {
	const accept = String(request.headers.get("accept") || "").toLowerCase();
	return accept.includes("text/html");
}

function buildContentSecurityPolicy() {
	const directives = [
		"default-src 'self'",
		"base-uri 'self'",
		"frame-ancestors 'none'",
		"object-src 'none'",
		"form-action 'self'",
		"img-src 'self' data: https:",
		"font-src 'self' data: https://db.onlinewebfonts.com",
		"style-src 'self' 'unsafe-inline'",
		"style-src-elem 'self' 'unsafe-inline' https://db.onlinewebfonts.com",
		"connect-src 'self' https: wss: ws:",
		IS_PRODUCTION ? "script-src 'self'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
	];

	if (IS_PRODUCTION) {
		directives.push("upgrade-insecure-requests");
	}

	if (TRUSTED_TYPES_ENFORCE) {
		directives.push("require-trusted-types-for 'script'");
		directives.push("trusted-types nextjs filspresso");
	}

	return directives.join("; ");
}

function applyPageSecurityHeaders(request: NextRequest, response: NextResponse) {
	if (!isHtmlNavigation(request)) {
		return response;
	}

	response.headers.set("Content-Security-Policy", buildContentSecurityPolicy());
	if (!TRUSTED_TYPES_ENFORCE) {
		response.headers.set(
			"Content-Security-Policy-Report-Only",
			"require-trusted-types-for 'script'; trusted-types nextjs filspresso",
		);
	}
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
	response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
	response.headers.set("Cross-Origin-Resource-Policy", "same-site");

	return response;
}

export function proxy(request: NextRequest) {
	const { nextUrl } = request;
	const pathname = nextUrl.pathname;

	if (shouldBypass(pathname)) {
		return applyPageSecurityHeaders(request, NextResponse.next());
	}

	const normalized = pathname.replace(/^\/+|\/+$/g, "");
	if (supportedSlugs.has(normalized)) {
		const rewriteUrl = nextUrl.clone();
		rewriteUrl.pathname = "/";
		rewriteUrl.searchParams.set("page", normalized === "home" ? "home" : normalized);
		return applyPageSecurityHeaders(request, NextResponse.rewrite(rewriteUrl));
	}

	return applyPageSecurityHeaders(request, NextResponse.next());
}

export const config = {
	matcher: ["/:path*"],
};
