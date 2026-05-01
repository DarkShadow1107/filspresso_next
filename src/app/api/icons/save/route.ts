import { NextResponse } from "next/server";

const DEFAULT_AI_ORIGIN = "http://localhost:5000";
const CONTAINER_AI_ORIGINS = ["http://ai:5000", "http://python-ai:5000"];

function normalizeOrigin(origin: string) {
	return origin.replace(/\/+$/, "");
}

function uniqueOrigins(origins: string[]) {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const origin of origins) {
		const normalized = normalizeOrigin(origin.trim());
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function resolveAiOrigins() {
	return uniqueOrigins([
		process.env.PYTHON_AI_HOST || "",
		process.env.NEXT_PUBLIC_AI_URL || "",
		...CONTAINER_AI_ORIGINS,
		DEFAULT_AI_ORIGIN,
	]);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
	let payload: { username?: string; svg?: string };
	try {
		payload = (await request.json()) as { username?: string; svg?: string };
	} catch {
		return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
	}

	if (!payload || typeof payload.username !== "string" || typeof payload.svg !== "string") {
		return NextResponse.json({ error: "username and svg are required" }, { status: 400 });
	}

	const origins = resolveAiOrigins();
	const deadline = Date.now() + 6000;
	let lastError: unknown = null;

	for (const origin of origins) {
		const remainingMs = deadline - Date.now();
		if (remainingMs <= 250) break;

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), Math.max(800, remainingMs));

		try {
			const response = await fetch(`${origin}/api/icons/save`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify(payload),
				cache: "no-store",
				signal: controller.signal,
			});

			const contentType = response.headers.get("content-type") || "application/json";
			const bodyText = await response.text();

			return new NextResponse(bodyText, {
				status: response.status,
				headers: {
					"Content-Type": contentType,
					"Cache-Control": "no-store",
				},
			});
		} catch (error) {
			lastError = error;
		} finally {
			clearTimeout(timeout);
		}
	}

	const message = lastError instanceof Error ? lastError.message : "AI icon service unavailable";
	return NextResponse.json(
		{ status: "error", error: "AI_ICON_SERVICE_UNAVAILABLE", message },
		{ status: 503, headers: { "Cache-Control": "no-store" } },
	);
}
