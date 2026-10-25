import { resolveAiHost } from "@/lib/server/aiHost";
import { aiServiceHeaders } from "@/lib/server/aiHeaders";
import { checkPromptLimit } from "@/lib/server/promptLimits";
import { MODEL_FILE_BY_KEY, isPlaygroundModelKey, isVisionModelKey, type ModelKey } from "@/lib/modelAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function modelKey(value: string): ModelKey | undefined {
	return isPlaygroundModelKey(value) ? value : (Object.keys(MODEL_FILE_BY_KEY) as ModelKey[]).find(key => MODEL_FILE_BY_KEY[key] === value);
}

/** Status inspection has no model-load side effects, even with a forged load query. */
export async function GET(request: Request) {
	const incoming = new URL(request.url);
	if (incoming.searchParams.has("load")) return Response.json({ error: "READ_ONLY_STATUS" }, { status: 400 });
	const selected = incoming.searchParams.get("model") || "";
	const key = selected ? modelKey(selected) : undefined;
	if (selected && !key) return Response.json({ error: "UNKNOWN_MODEL" }, { status: 400 });
	try {
		const url = new URL(`${await resolveAiHost()}/api/model-status`);
		if (key) url.searchParams.set("model", MODEL_FILE_BY_KEY[key]);
		const response = await fetch(url, { headers: aiServiceHeaders(), cache: "no-store", signal: AbortSignal.timeout(5000) });
		return Response.json(await response.json(), { status: response.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
	} catch { return Response.json({ error: "AI_UNAVAILABLE" }, { status: 503 }); }
}

/** Kafelot keeps its own model/allowance rules, including fingerprint-budgeted visitors. */
export async function POST(request: Request) {
	let body: { model?: unknown };
	try { body = await request.json(); } catch { return Response.json({ error: "BAD_REQUEST" }, { status: 400 }); }
	const key = typeof body?.model === "string" ? modelKey(body.model) : undefined;
	if (!key) return Response.json({ error: "UNKNOWN_MODEL" }, { status: 400 });
	const access = await checkPromptLimit(request, true, "general", key);
	if (!access.allowed) return access.errorResponse || Response.json({ error: "BILLING_UNAVAILABLE" }, { status: 503 });
	try {
		const response = await fetch(`${await resolveAiHost()}/api/warmup`, { method: "POST", headers: { "Content-Type": "application/json", ...aiServiceHeaders() },
			body: JSON.stringify({ model: MODEL_FILE_BY_KEY[key], vision: isVisionModelKey(key) }), signal: AbortSignal.timeout(10_000), cache: "no-store" });
		return Response.json(await response.json(), { status: response.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
	} catch { return Response.json({ error: "AI_UNAVAILABLE" }, { status: 503 }); }
}
