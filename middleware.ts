import { NextResponse, type NextRequest } from "next/server";

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

export function middleware(request: NextRequest) {
	const { nextUrl } = request;
	const pathname = nextUrl.pathname;

	if (shouldBypass(pathname)) {
		return NextResponse.next();
	}

	const normalized = pathname.replace(/^\/+|\/+$/g, "");
	if (supportedSlugs.has(normalized)) {
		const rewriteUrl = nextUrl.clone();
		rewriteUrl.pathname = "/";
		rewriteUrl.searchParams.set("page", normalized === "home" ? "home" : normalized);
		return NextResponse.rewrite(rewriteUrl);
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/:path*"],
};
