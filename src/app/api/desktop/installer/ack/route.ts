import type { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export async function POST(request: NextRequest) {
	// Never replay an acknowledgement after an ambiguous upstream failure.
	return proxyBackendRequest(request, "/api/desktop/installer/ack", {
		timeoutMs: 8000,
		retry: false,
		responseHeaders: { "Cache-Control": "private, no-store" },
	});
}
