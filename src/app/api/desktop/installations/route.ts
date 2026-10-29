import type { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/desktop/installations", {
		timeoutMs: 8000,
		responseHeaders: { "Cache-Control": "private, no-store" },
	});
}
