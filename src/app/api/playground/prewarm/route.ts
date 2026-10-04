import { NextRequest, NextResponse } from "next/server";
import { resolveAiHost } from "@/lib/server/aiHost";
import { readCallerTier } from "@/lib/server/promptLimits";
import {
	MODEL_FILE_BY_KEY,
	isVisionModelKey,
	tierAllowsModel,
	type ModelKey,
} from "@/lib/modelAccess";
import { PLAYGROUND_MINIMUM_TIER } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Pre-loads a model into its llama.cpp slot so the first real prompt does not
 * pay the cold-load cost. Two entry points:
 *
 *   POST { model }  -> schedule the load (idempotent while one is in flight)
 *   GET  ?model=    -> poll current state
 *
 * Warming never consumes a Kafelot prompt because it does not go through the
 * limiter.
 *
 * This route is gated on BOTH the Playground tier and the model's own tier, and
 * both checks are load-bearing:
 *
 * - The Playground tier check was missing here even though it is enforced in
 *   `playground/chat`. Without it any signed-in `free` account could schedule
 *   loads, and because only one model is resident at a time that is a way to
 *   evict the model a paying user is using. It also made the Playground gate
 *   trivially bypassable.
 * - The model tier check alone is not enough for the same reason: it does not
 *   imply Playground access.
 *
 * Both now read the same `PLAYGROUND_MINIMUM_TIER` constant the UI and the chat
 * route use, so the three cannot drift apart again.
 */

const PLAYGROUND_LOCKED = {
	status: "forbidden",
	error: "Model Playground requires a MAX or ULTIMATE subscription",
} as const;

/** Returns an error payload when the caller may not use the Playground. */
function playgroundGate(tier: string | null) {
	if (!tier || !PLAYGROUND_MINIMUM_TIER.includes(tier as never)) {
		return NextResponse.json(PLAYGROUND_LOCKED, { status: 403 });
	}
	return null;
}

type WarmupPayload = { status?: string; duration_ms?: number | null };

function json(body: unknown, status = 200) {
	return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function callPython(path: string, init: RequestInit = {}, timeoutMs = 5000) {
	const host = await resolveAiHost();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${host}${path}`, { ...init, cache: "no-store", signal: controller.signal });
		const text = await response.text();
		let payload: WarmupPayload | null = null;
		try {
			payload = text ? (JSON.parse(text) as WarmupPayload) : null;
		} catch {
			payload = { status: "error" };
		}
		return { ok: response.ok, status: response.status, payload };
	} catch {
		return { ok: false, status: 503, payload: { status: "unavailable" } as WarmupPayload };
	} finally {
		clearTimeout(timer);
	}
}

function resolveWarmedPayload(payload: WarmupPayload | null, modelKey: ModelKey, tier: string) {
	return {
		...(payload ?? {}),
		model_key: modelKey,
		tier,
	};
}

export async function GET(request: NextRequest) {
	const tier = await readCallerTier(request);
	if (!tier) {
		return json({ status: "unauthorized", error: "Sign in to check model readiness" }, 401);
	}
	const gate = playgroundGate(tier);
	if (gate) return gate;

	const requested = (request.nextUrl.searchParams.get("model") || "").trim();
	if (!requested) {
		const result = await callPython("/api/warmup");
		return json(result.payload, result.ok ? 200 : 503);
	}

	if (!Object.prototype.hasOwnProperty.call(MODEL_FILE_BY_KEY, requested)) {
		return json({ status: "rejected", error: `unknown model ${requested}` }, 400);
	}
	const modelKey = requested as ModelKey;
	if (!tierAllowsModel(tier, modelKey)) {
		return json({ status: "forbidden", model: modelKey, error: "Model not available on your plan" }, 403);
	}

	const search = new URLSearchParams({
		model: MODEL_FILE_BY_KEY[modelKey],
		vision: String(isVisionModelKey(modelKey)),
	});
	const result = await callPython(`/api/warmup?${search.toString()}`, {}, 4000);

	return json(resolveWarmedPayload(result.payload, modelKey, tier), result.ok ? 200 : 503);
}

export async function POST(request: NextRequest) {
	const tier = await readCallerTier(request);
	if (!tier) {
		return json({ status: "unauthorized", error: "Sign in to pre-load models" }, 401);
	}
	const gate = playgroundGate(tier);
	if (gate) return gate;

	let body: { model?: unknown } = {};
	try {
		body = (await request.json()) as { model?: unknown };
	} catch {
		return json({ status: "rejected", error: "Expected a JSON body" }, 400);
	}

	const requested = typeof body.model === "string" ? body.model.trim() : "";
	if (!requested || !Object.prototype.hasOwnProperty.call(MODEL_FILE_BY_KEY, requested)) {
		return json({ status: "rejected", error: `unknown model ${requested}` }, 400);
	}
	const modelKey = requested as ModelKey;
	if (!tierAllowsModel(tier, modelKey)) {
		return json({ status: "forbidden", model: modelKey, error: "Model not available on your plan" }, 403);
	}

	const vision = isVisionModelKey(modelKey);
	const result = await callPython(
		"/api/warmup",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: MODEL_FILE_BY_KEY[modelKey], vision }),
		},
		4000,
	);

	return json(resolveWarmedPayload(result.payload, modelKey, tier), result.ok ? 200 : 503);
}