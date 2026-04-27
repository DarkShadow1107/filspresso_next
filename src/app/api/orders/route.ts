import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const emptyOrders = () =>
	NextResponse.json({ orders: [], source: "static-fallback" }, { headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/orders", { timeoutMs: 1800, fallback: emptyOrders });
}

export async function POST(request: NextRequest) {
	return proxyBackendRequest(request, "/api/orders", { timeoutMs: 6000 });
}
