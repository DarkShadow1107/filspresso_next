import { proxyBackendRequest } from "@/lib/server/backend";
import type { NextRequest } from "next/server";

/**
 * The Spectre subscription's public terms, for the plans page.
 *
 * Fetched rather than hardcoded because these numbers decide a charge. The component keeps
 * a copy in `SPECTRE_SUBSCRIPTION` for first paint; this is what is authoritative and what
 * a change to the price must touch.
 */
export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/spectre/subscription", { timeoutMs: 8000 });
}