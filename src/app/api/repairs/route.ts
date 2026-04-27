import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const emptyRepairs = () =>
	NextResponse.json({ repairs: [], source: "static-fallback" }, { headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/repairs", { timeoutMs: 1800, fallback: emptyRepairs });
}

export async function POST(request: NextRequest) {
	return proxyBackendRequest(request, "/api/repairs", { timeoutMs: 6000 });
}
