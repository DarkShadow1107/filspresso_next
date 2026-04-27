import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/subscriptions", {
		timeoutMs: 1800,
		fallback: subscriptionFallback,
	});
}

export async function POST(request: NextRequest) {
	return proxyBackendRequest(request, "/api/subscriptions", { timeoutMs: 6000 });
}
