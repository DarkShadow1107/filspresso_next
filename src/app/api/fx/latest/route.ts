import { NextResponse } from "next/server";
import { FALLBACK_FX_RATES, FX_FETCH_CODES, sanitizeFxRates } from "@/lib/paymentCurrency";

type FxApiResponse = {
	date?: string;
	rates?: Record<string, number>;
};

type FxSource = "live_frankfurter" | "live_open_er_api" | "cached_live" | "cached_live_stale" | "static_fallback";

type FxLiveResult = {
	date?: string;
	rates: Record<string, number>;
	source: FxSource;
};

type FxCacheEntry = {
	base: string;
	date: string;
	rates: Record<string, number>;
	fetchedAt: number;
};

const FX_TIMEOUT_MS = 7000;
const FX_CACHE_FRESH_MS = 36 * 60 * 60 * 1000;
const FX_CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

let lastLiveFxCache: FxCacheEntry | null = null;

function toIsoDate(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed.toISOString().slice(0, 10);
		}
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		const parsed = new Date(value * 1000);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed.toISOString().slice(0, 10);
		}
	}

	return null;
}

function parseRequestedCodes(rawTo: string, base: string): string[] {
	const fallback = rawTo || FX_FETCH_CODES;
	const requested = fallback
		.split(",")
		.map((part) => part.trim().toUpperCase())
		.filter((code) => /^[A-Z]{3}$/.test(code))
		.filter((code) => code !== base);

	return [...new Set(requested)];
}

function buildRatesPayload(base: string, rates: Record<string, number>): Record<string, number> {
	return { [base]: 1, ...rates };
}

async function fetchFrankfurter(from: string, toCodes: string[]): Promise<FxLiveResult | null> {
	if (!toCodes.length) return null;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FX_TIMEOUT_MS);
	try {
		const response = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${toCodes.join(",")}`, {
			cache: "no-store",
			signal: controller.signal,
		});
		if (!response.ok) return null;
		const payload = (await response.json()) as FxApiResponse;
		const rates = sanitizeFxRates(payload.rates);
		if (!Object.keys(rates).length) return null;
		return {
			date: payload.date,
			rates: rates as Record<string, number>,
			source: "live_frankfurter",
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchOpenErApi(from: string, toCodes: string[]): Promise<FxLiveResult | null> {
	if (!toCodes.length) return null;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FX_TIMEOUT_MS);
	try {
		const response = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
			cache: "no-store",
			signal: controller.signal,
		});
		if (!response.ok) return null;

		const payload = (await response.json()) as {
			result?: string;
			time_last_update_utc?: string;
			time_last_update_unix?: number;
			rates?: Record<string, number>;
		};
		if (payload.result && payload.result !== "success") return null;

		const selectedRates: Record<string, number> = {};
		for (const code of toCodes) {
			const value = Number(payload.rates?.[code]);
			if (Number.isFinite(value) && value > 0) {
				selectedRates[code] = value;
			}
		}

		const rates = sanitizeFxRates(selectedRates);
		if (!Object.keys(rates).length) return null;

		return {
			date: toIsoDate(payload.time_last_update_utc) || toIsoDate(payload.time_last_update_unix) || undefined,
			rates: rates as Record<string, number>,
			source: "live_open_er_api",
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function readCachedRates(base: string): { date: string; rates: Record<string, number>; stale: boolean; source: FxSource } | null {
	if (!lastLiveFxCache || lastLiveFxCache.base !== base) {
		return null;
	}

	const ageMs = Date.now() - lastLiveFxCache.fetchedAt;
	if (ageMs <= FX_CACHE_FRESH_MS) {
		return {
			date: lastLiveFxCache.date,
			rates: lastLiveFxCache.rates,
			stale: false,
			source: "cached_live",
		};
	}

	if (ageMs <= FX_CACHE_STALE_MS) {
		return {
			date: lastLiveFxCache.date,
			rates: lastLiveFxCache.rates,
			stale: true,
			source: "cached_live_stale",
		};
	}

	return null;
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const from = String(url.searchParams.get("from") || "RON")
		.trim()
		.toUpperCase();
	const to = String(url.searchParams.get("to") || FX_FETCH_CODES)
		.trim()
		.toUpperCase();
	const requestedCodes = parseRequestedCodes(to, from);
	const today = new Date().toISOString().slice(0, 10);

	const live = (await fetchFrankfurter(from, requestedCodes)) || (await fetchOpenErApi(from, requestedCodes));

	if (live) {
		const ratesPayload = buildRatesPayload(from, live.rates);
		lastLiveFxCache = {
			base: from,
			date: live.date || today,
			rates: ratesPayload,
			fetchedAt: Date.now(),
		};

		return NextResponse.json({
			base: from,
			date: live.date || today,
			rates: ratesPayload,
			stale: false,
			source: live.source,
		});
	}

	const cached = readCachedRates(from);
	if (cached) {
		return NextResponse.json({
			base: from,
			date: cached.date,
			rates: cached.rates,
			stale: cached.stale,
			source: cached.source,
		});
	}

	const fallbackRates = from === "RON" ? FALLBACK_FX_RATES : ({ [from]: 1 } as Record<string, number>);

	return NextResponse.json({
		base: from,
		date: today,
		rates: fallbackRates,
		stale: true,
		source: "static_fallback" as const,
	});
}
