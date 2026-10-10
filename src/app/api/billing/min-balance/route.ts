import { proxyBackendRequest } from "@/lib/server/backend";
import type { NextRequest } from "next/server";

/**
 * The customer's own wallet floor: the balance at or below which generation stops and the
 * automatic refill triggers. A negative floor is a deliberate overdraft.
 *
 * PATCH, so it goes through the same relay as everything else and the CSRF guard applies to
 * it exactly as it does to a top-up.
 */
export async function PATCH(request: NextRequest) {
	return proxyBackendRequest(request, "/api/billing/min-balance", { timeoutMs: 8000 });
}