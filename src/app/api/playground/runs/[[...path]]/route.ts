import type { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };

/**
 * Run replay and account-level deletion, proxied to the Nest backend. The backend scopes
 * both by the caller's account id; a run id that belongs to someone else is simply an empty
 * list, and `DELETE /api/playground/runs` is the way to erase Playground run history.
 */
async function proxy(request: NextRequest, context: Context) {
	const { path = [] } = await context.params;
	if (path.length > 1 || path.some(part => !/^[a-z0-9-]+$/.test(part) || part.length > 64)) return Response.json({ message: "Invalid runs operation." }, { status: 400 });
	const target = `/api/playground/runs${path.length ? `/${path.join("/")}` : ""}`;
	return proxyBackendRequest(request, target, { timeoutMs: 25_000, retry: request.method === "GET" });
}

export { proxy as GET, proxy as DELETE };
