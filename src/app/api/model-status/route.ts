import { NextResponse } from "next/server";

import { resolveAiHost } from "@/lib/server/aiHost";
import { MODEL_FILE_BY_KEY, type ModelKey } from "@/lib/modelAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxies the AI gateway's model residency endpoint.
 *
 * Only one chat model is resident at a time -- the llama.cpp router runs with
 * --models-max 1 -- so asking for a different model means unloading the current
 * one first. That takes seconds for the small models and minutes for the 8B, so
 * the UI has to show progress instead of a spinner. This route exists so the
 * browser can poll `?model=<key>` and read `status` / `progress`, and kick a load
 * off with `?load=<key>` without holding a request open.
 */
export async function GET(request: Request) {
	const host = await resolveAiHost();
	const url = new URL(`${host}/api/model-status`);
	const incoming = new URL(request.url);

	// Forward the two parameters we care about, validated against the catalog so a
	// typo cannot be forwarded to the gateway as an arbitrary model name.
	const model = incoming.searchParams.get("model") ?? "";
	const load = incoming.searchParams.get("load") ?? "";
	const vision = incoming.searchParams.get("vision") ?? "";

	// Accept either a model key ("lfm2_5_8b_a1b_q4_k_m") or the GGUF filename
	// ("LFM2.5-8B-A1B-Q4_K_M.gguf"), and always forward the filename, which is
	// what the gateway keys on. Validating against the catalog stops a typo being
	// forwarded as an arbitrary model name.
	const toFilename = (value: string): string | null => {
		if (Object.prototype.hasOwnProperty.call(MODEL_FILE_BY_KEY, value)) {
			return MODEL_FILE_BY_KEY[value as ModelKey];
		}
		const filename = Object.values(MODEL_FILE_BY_KEY).find((file) => file === value);
		return filename ?? null;
	};

	const modelFile = model ? toFilename(model) : "";
	const loadFile = load ? toFilename(load) : "";

	for (const value of [model, load]) {
		if (value && !toFilename(value)) {
			return NextResponse.json(
				{ error: "UNKNOWN_MODEL", message: `Unknown model: ${value}` },
				{ status: 400 },
			);
		}
	}

	if (modelFile) url.searchParams.set("model", modelFile);
	if (loadFile) url.searchParams.set("load", loadFile);
	if (vision) url.searchParams.set("vision", vision);

	try {
		const upstream = await fetch(url, { cache: "no-store" });
		const payload = await upstream.json().catch(() => null);
		if (!upstream.ok) {
			return NextResponse.json(
				{ error: "MODEL_STATUS_UNAVAILABLE", message: "Could not read model status." },
				{ status: 502 },
			);
		}
		return NextResponse.json(payload);
	} catch {
		return NextResponse.json(
			{ error: "AI_UNAVAILABLE", message: "The AI runtime is unavailable right now." },
			{ status: 503 },
		);
	}
}
