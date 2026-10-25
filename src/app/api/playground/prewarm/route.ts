import type { NextRequest } from "next/server";
import { resolveAiHost } from "@/lib/server/aiHost";
import { aiServiceHeaders } from "@/lib/server/aiHeaders";
import { proxyBackendRequest } from "@/lib/server/backend";
import { readCallerTier } from "@/lib/server/promptLimits";
import { resolveSpectreAccess } from "@/lib/server/spectreAccess";
import { MODEL_FILE_BY_KEY, isPlaygroundModelKey, isVisionModelKey } from "@/lib/modelAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: NextRequest) {
	return proxyBackendRequest(request, "/api/playground/models/load", { timeoutMs: 15_000 });
}

export async function GET(request: NextRequest) {
	if (!await readCallerTier(request)) return Response.json({ status: "unauthorized" }, { status: 401 });
	if (!(await resolveSpectreAccess(request)).hasAccess) return Response.json({ status: "forbidden" }, { status: 403 });
	const model = request.nextUrl.searchParams.get("model") || "";
	if (!isPlaygroundModelKey(model)) return Response.json({ status: "rejected", error: "UNKNOWN_MODEL" }, { status: 400 });
	try {
		const host = await resolveAiHost();
		const query = new URLSearchParams({ model: MODEL_FILE_BY_KEY[model], vision: String(isVisionModelKey(model)) });
		const response = await fetch(`${host}/api/warmup?${query}`, { headers: aiServiceHeaders(), cache: "no-store", signal: AbortSignal.timeout(5000) });
		return Response.json(await response.json(), { status: response.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
	} catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}
