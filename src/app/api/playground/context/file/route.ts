import type { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
	const length = Number(request.headers.get("content-length") || 0);
	if (length > 21 * 1024 * 1024) return Response.json({ message: "Choose a file no larger than 20 MB." }, { status: 413 });
	return proxyBackendRequest(request, "/api/playground/context/file", { timeoutMs: 16 * 60 * 1000 });
}
