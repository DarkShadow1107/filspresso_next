import { proxyBackendRequest } from "@/lib/server/backend";
import type { NextRequest } from "next/server";

/**
 * The model price list.
 *
 * `?audience=api` asks for list prices rather than the signed-in plan's rates. The query
 * string is relayed untouched, so the browser chooses which audience it is asking about and
 * the backend decides what that caller may see -- never this route.
 */
export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/billing/pricing", { timeoutMs: 8000 });
}