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
	const responseHeaders =
		routePath[0] === "popular"
			? { "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=900" }
			: undefined;

	return proxyBackendRequest(request, backend, {
		timeoutMs: 1800,
		fallback: () => NextResponse.json({ products: [], source: "static-fallback" }),
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
