import type { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
	return proxyBackendRequest(request, "/api/playground/context/github", { timeoutMs: 90_000 });
}
