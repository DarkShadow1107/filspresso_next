import { proxyBackendRequest } from "@/lib/server/backend";
import type { NextRequest } from "next/server";

/**
 * Whether this account may use the Spectre Playground, and why.
 *
 * Proxied rather than fetched client-side to the backend, for the same reason the other
 * billing routes are: the session cookie is same-origin, and the answer must come from the
 * service that enforces the gate so the UI cannot show access the route would refuse.
 */
export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/spectre/access", { timeoutMs: 8000 });
}