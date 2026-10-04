import { lookup } from "node:dns/promises";

/**
 * Resolves a reachable base URL for the Python AI service.
 *
 * `PYTHON_AI_HOST` is normally the compose-internal `http://ai:5000`, which does
 * not resolve when the Next server runs on the host during development. Rather
 * than depending on which network the caller is on, probe the candidates in
 * order and keep the first that answers.
 */
const AI_HOST_CANDIDATES = [
	process.env.PYTHON_AI_HOST || "",
	"http://localhost:5000",
	"http://127.0.0.1:5000",
];

function uniqueOrigins(origins: string[]) {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const origin of origins) {
		const normalized = origin.trim().replace(/\/+$/, "");
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

async function hostResolves(hostname: string): Promise<boolean> {
	try {
		await lookup(hostname);
		return true;
	} catch {
		return false;
	}
}

let cachedHost: string | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

export async function resolveAiHost(): Promise<string> {
	if (cachedHost && Date.now() - cachedAt < CACHE_MS) {
		return cachedHost;
	}

	const candidates = uniqueOrigins(AI_HOST_CANDIDATES.length ? AI_HOST_CANDIDATES : ["http://localhost:5000"]);

	for (const candidate of candidates) {
		let hostname = "";
		try {
			hostname = new URL(candidate).hostname;
		} catch {
			continue;
		}

		// Container hostnames only exist inside the compose network; skip them
		// rather than waiting for a DNS timeout.
		if (hostname && !/^(localhost|127\.0\.0\.1)$/i.test(hostname)) {
			if (!(await hostResolves(hostname))) continue;
		}

		cachedHost = candidate;
		cachedAt = Date.now();
		return candidate;
	}

	const fallback = "http://localhost:5000";
	cachedHost = fallback;
	cachedAt = Date.now();
	return fallback;
}
