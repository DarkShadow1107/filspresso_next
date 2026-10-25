import type { NextRequest } from "next/server";
import { proxyBackendStream } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Nest owns authentication, model affordability, operation IDs and settlement for both clients. */
export function POST(request: NextRequest) {
	return proxyBackendStream(request, "/api/playground/chat/stream");
}
