import { proxyBackendRequest } from "@/lib/server/backend";
import type { NextRequest } from "next/server";

/**
 * What each plan includes per month, in RON.
 *
 * Public by design -- the plans page has to quote a plan's value to someone who has not
 * signed up yet. Proxied rather than fetched directly so the plans page never hardcodes a
 * second copy of these numbers, which is how it ended up advertising a prompt quota that had
 * been deleted months earlier.
 */
export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/billing/allowances", { timeoutMs: 8000 });
}