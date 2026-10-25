import type { NextRequest } from "next/server";
import { proxyBackendStream } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A bounded JSON model turn. The stream proxy preserves cancellation and never retries POSTs. */
export function POST(request: NextRequest) { return proxyBackendStream(request, "/api/playground/agent/turn"); }
