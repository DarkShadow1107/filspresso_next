import type { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) { return proxyBackendRequest(request, "/api/playground/agent/capabilities", { timeoutMs: 8_000, retry: false }); }
