import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function backendPath(params: Promise<{ path?: string[] }>) {
	const { path = [] } = await params;
	return `/api/subscriptions${path.length ? `/${path.map(encodeURIComponent).join("/")}` : ""}`;
}

function subscriptionFallback() {
	return NextResponse.json(
		{
			subscription: {
				tier: "free",
				status: "offline_fallback",
			},
			source: "static-fallback",
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	const path = await backendPath(context.params);
	return proxyBackendRequest(request, path, {
		timeoutMs: 1800,
		fallback: path === "/api/subscriptions" ? subscriptionFallback : undefined,
	});
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	return proxyBackendRequest(request, await backendPath(context.params), { timeoutMs: 6000 });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	return proxyBackendRequest(request, await backendPath(context.params), { timeoutMs: 6000 });
}
