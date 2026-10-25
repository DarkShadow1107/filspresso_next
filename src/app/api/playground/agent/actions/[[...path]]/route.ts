import type { NextRequest } from "next/server";
import { proxyBackendStream } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
async function proxy(request: NextRequest, context: Context) {
	const { path = [] } = await context.params;
	const capability = path.length === 1 && path[0] === "capabilities" && request.method === "GET";
	const prepare = path.length === 0 && request.method === "POST";
	const execute = path.length === 2 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(path[0]) && path[1] === "execute" && request.method === "POST";
	if (!capability && !prepare && !execute) return Response.json({ error: "INVALID_AGENT_ACTION_ROUTE" }, { status: 400 });
	return proxyBackendStream(request, "/api/playground/agent/actions" + (path.length ? "/" + path.join("/") : ""));
}
export { proxy as GET, proxy as POST };
