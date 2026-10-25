import type { NextRequest } from "next/server";
import { proxyBackendRequest, proxyBackendStream } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };

async function proxy(request: NextRequest, context: Context) {
	const { path = [] } = await context.params;
	if (path.some(part => !/^[a-z0-9-]+$/.test(part)) || path.length > 2) return Response.json({ message: "Invalid sandbox operation." }, { status: 400 });
	const target = `/api/playground/sandbox${path.length ? `/${path.join("/")}` : ""}`;
	return path.at(-1) === "run" && request.method === "POST" ? proxyBackendStream(request, target) : proxyBackendRequest(request, target, { timeoutMs: 25_000, retry: request.method === "GET" });
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
