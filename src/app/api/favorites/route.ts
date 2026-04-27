import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const emptyFavorites = () =>
	NextResponse.json({ favorites: [], source: "static-fallback" }, { headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/favorites", { timeoutMs: 1800, fallback: emptyFavorites });
}

export async function POST(request: NextRequest) {
	return proxyBackendRequest(request, "/api/favorites", { timeoutMs: 6000 });
}
