import type { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The documents surface is pathed by uuid only: one segment, one pattern. */
function isDocumentId(segment: string) {
	return UUID_PATTERN.test(segment);
}

/**
 * Account-scoped documents, proxied to the Nest backend, which owns authentication and
 * scoping. Mutations never fail over to a second origin: a replayed create would silently
 * store a duplicate.
 */
async function proxy(request: NextRequest, context: Context) {
	const { path = [] } = await context.params;
	const valid = path.length === 0 || (path.length === 1 && isDocumentId(path[0])) ||
		(path.length === 3 && request.method === "GET" && isDocumentId(path[0]) && path[1] === "export" && ["pdf", "docx", "pptx", "xlsx"].includes(path[2]));
	if (!valid) return Response.json({ message: "Invalid documents operation." }, { status: 400 });
	const target = `/api/playground/documents${path.length ? `/${path.join("/")}` : ""}`;
	return proxyBackendRequest(request, target, { timeoutMs: 25_000, retry: request.method === "GET" });
}

export { proxy as GET, proxy as POST, proxy as DELETE };
