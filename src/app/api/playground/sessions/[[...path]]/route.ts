import type { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };

/** Session ids and run ids are the only pathing surface; everything else is a query. */
function isSegment(segment: string) {
	return /^[a-z0-9-]+$/.test(segment) && segment.length <= 64;
}

/**
 * Durable Playground state, proxied to the Nest backend, which owns authentication, scoping
 * and the deletion controls. Mutations never fail over to a second origin: replaying a
 * PATCH would stamp a second checkpoint where only one was asked for, and replaying a
 * delete is at best confusing.
 */
async function proxy(request: NextRequest, context: Context) {
	const { path = [] } = await context.params;
	if (path.length > 1 || path.some(part => !isSegment(part))) return Response.json({ message: "Invalid sessions operation." }, { status: 400 });
	const target = `/api/playground/sessions${path.length ? `/${path.join("/")}` : ""}`;
	return proxyBackendRequest(request, target, { timeoutMs: 25_000, retry: request.method === "GET" });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
