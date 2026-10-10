import { proxyBackendRequest } from "@/lib/server/backend";
import type { NextRequest } from "next/server";

/**
 * The account's balance, allowance and recent spend.
 *
 * This route exists because the browser cannot call the NestJS backend directly and have the
 * session cookie travel with it: the cookie is scoped to this origin, and a cross-origin
 * request would need CORS plus credentials for a money-bearing response. Proxying keeps the
 * cookie same-origin, which is also why the backend's CSRF guard is satisfied -- `origin` and
 * `referer` are relayed by `proxyBackendRequest`.
 *
 * It was absent while the account page and the coffee window both fetched this path, so both
 * were quietly rendering nothing.
 */
export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/billing/balance", { timeoutMs: 8000 });
}