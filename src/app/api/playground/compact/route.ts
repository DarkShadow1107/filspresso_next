import type { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One explicit metered operation. Never replay a lost POST response. */
export function POST(request: NextRequest) {
	return proxyBackendRequest(request, "/api/playground/compact", { timeoutMs: 245_000, retry: false });
}
