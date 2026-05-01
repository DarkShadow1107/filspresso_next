import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { fetchJsonWithTimeout } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Health probe for the optional Python AI service. It returns a successful
// response even when Python is offline so the UI can fall back without noisy 502s.
export async function GET() {
	try {
		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const fallbackHosts = ["http://localhost:5000", "http://127.0.0.1:5000"];
		const tryDockerHost = (() => {
			try {
				const url = new URL(PY_HOST);
				return url.hostname !== "ai";
			} catch {
				return true;
			}
		})();
		let candidateHosts = [PY_HOST, ...fallbackHosts].filter((host, index, hosts) => hosts.indexOf(host) === index);
		if (!tryDockerHost) {
			try {
				await lookup("ai");
			} catch {
				candidateHosts = fallbackHosts;
			}
		}
		let json: Record<string, unknown> | null = null;
		for (const host of candidateHosts) {
			for (let attempt = 0; attempt < 2 && !json; attempt += 1) {
				try {
					json = await fetchJsonWithTimeout<Record<string, unknown>>(`${host}/api/health`, {
						cache: "no-store",
						timeoutMs: 3000,
					});
				} catch {
					// Retry once per host to absorb short cold-start spikes from the Python container.
				}
			}
		}
		if (!json) {
			throw new Error("Python health probe unavailable");
		}
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
