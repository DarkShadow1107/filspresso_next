import { NextResponse } from "next/server";
import { fetchJsonWithTimeout } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Health probe for the optional Python AI service. It returns a successful
// response even when Python is offline so the UI can fall back without noisy 502s.
export async function GET() {
	try {
		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const json = await fetchJsonWithTimeout<Record<string, unknown>>(`${PY_HOST}/api/health`, {
			cache: "no-store",
			timeoutMs: 1200,
		});
		return NextResponse.json(json, {
			headers: {
				"Cache-Control": "public, max-age=15, stale-while-revalidate=60",
			},
		});
	} catch {
		return NextResponse.json(
			{ status: "offline", healthy: false, smarterAI: false },
			{
				headers: {
					"Cache-Control": "public, max-age=15, stale-while-revalidate=60",
					"x-filspresso-data-source": "offline-fallback",
				},
			},
		);
	}
}
