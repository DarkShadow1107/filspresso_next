import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function backendPath(params: Promise<{ path?: string[] }>) {
	const { path = [] } = await params;
	return `/api/orders/${path.map(encodeURIComponent).join("/")}`;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	const path = await context.params;
	const backend = await backendPath(context.params);
	const routePath = path.path || [];
	const isPopular = routePath[0] === "popular";

	// The catalogue fallback is only meaningful for the popular-products route, which
	// is read by anonymous visitors on the shop page. It used to be the fallback for
	// *every* path here, so a slow aggregate -- the Member Status totals -- came back
	// as `{ products: [], source: "static-fallback" }`, which the account page read as
	// "no stats at all" and showed as a failed tab.
	const responseHeaders = isPopular
		? { "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=900" }
		: undefined;

	return proxyBackendRequest(request, backend, {
		// The account's own aggregates scan every order this account ever placed, so
		// they need longer than the 1.8 s the shop page needed.
		timeoutMs: isPopular ? 1800 : 8000,
		fallback: isPopular
			? () => NextResponse.json({ products: [], source: "static-fallback" })
			: undefined,
		responseHeaders,
	});
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	return proxyBackendRequest(request, await backendPath(context.params), { timeoutMs: 6000 });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	return proxyBackendRequest(request, await backendPath(context.params), { timeoutMs: 6000 });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	return proxyBackendRequest(request, await backendPath(context.params), { timeoutMs: 6000 });
}
