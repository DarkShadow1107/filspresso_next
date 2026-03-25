import { NextResponse } from "next/server";
import { FALLBACK_FX_RATES, FX_FETCH_CODES, sanitizeFxRates } from "@/lib/paymentCurrency";

type FxApiResponse = {
	date?: string;
	rates?: Record<string, number>;
};

const FX_TIMEOUT_MS = 7000;

async function fetchFrankfurter(from: string, to: string): Promise<FxApiResponse | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FX_TIMEOUT_MS);
	try {
		const response = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`, {
			cache: "no-store",
			signal: controller.signal,
		});
		if (!response.ok) return null;
		return (await response.json()) as FxApiResponse;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const from = String(url.searchParams.get("from") || "RON")
		.trim()
		.toUpperCase();
	const to = String(url.searchParams.get("to") || FX_FETCH_CODES)
		.trim()
		.toUpperCase();

	const live = await fetchFrankfurter(from, to);
	const liveRates = sanitizeFxRates(live?.rates as Record<string, number> | undefined);

	if (Object.keys(liveRates).length > 0) {
		return NextResponse.json({
			base: from,
			date: live?.date || new Date().toISOString().slice(0, 10),
			rates: { RON: 1, ...liveRates },
			stale: false,
		});
	}

	return NextResponse.json({
		base: "RON",
		date: new Date().toISOString().slice(0, 10),
		rates: FALLBACK_FX_RATES,
		stale: true,
	});
}
