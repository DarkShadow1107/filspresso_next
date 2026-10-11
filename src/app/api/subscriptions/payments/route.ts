import { proxyBackendRequest } from "@/lib/server/backend";
import type { NextRequest } from "next/server";

/**
 * What this account has paid for its subscriptions.
 *
 * Relayed so the session cookie stays same-origin, which is also what lets the backend
 * resolve whose history this is. There is no account id in the path or the query for a
 * client to tamper with.
 */
export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/subscriptions/payments", { timeoutMs: 8000 });
}