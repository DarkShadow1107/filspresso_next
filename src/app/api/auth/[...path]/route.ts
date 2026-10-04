import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function backendPath(params: Promise<{ path?: string[] }>) {
	const { path = [] } = await params;
	return `/api/auth/${path.map(encodeURIComponent).join("/")}`;
}

/**
 * When the backend is unreachable we must not claim the visitor is signed in.
 * The legacy shape is preserved so existing consumers keep working, but
 * `fetchCurrentAccount` treats `source: "static-fallback"` as signed out.
 */
function meFallback() {
	return NextResponse.json(
		{
			user: {
				subscription: "free",
				subscription_name: "free",
			},
			source: "static-fallback",
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	const path = await backendPath(context.params);
	return proxyBackendRequest(request, path, {
		timeoutMs: 4500,
		fallback: path === "/api/auth/me" ? meFallback : undefined,
	});
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	return proxyBackendRequest(request, await backendPath(context.params), { timeoutMs: 6000 });
}
