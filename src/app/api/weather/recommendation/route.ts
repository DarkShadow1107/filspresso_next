import { NextRequest, NextResponse } from "next/server";
import { buildBackendUrl, fetchJsonWithTimeout } from "@/lib/server/backend";
import type { WeatherRecommendationData } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function fallbackRecommendation(): WeatherRecommendationData {
	return {
		temperature: 21,
		weather_code: 0,
		is_day: 1,
		recommendation: {
			type: "warm",
			drink: "Balanced espresso",
			message: "A balanced espresso is a good default while live weather is unavailable.",
			icon: "clear-day",
		},
	};
}

export async function GET(request: NextRequest) {
	try {
		const data = await fetchJsonWithTimeout<WeatherRecommendationData>(
			buildBackendUrl("/api/weather/recommendation", request.nextUrl.search),
			{ timeoutMs: 1500, cache: "no-store" },
		);

		return NextResponse.json(data, {
			headers: {
				"Cache-Control": "public, max-age=300, stale-while-revalidate=900",
			},
		});
	} catch {
		return NextResponse.json(fallbackRecommendation(), {
			headers: {
				"Cache-Control": "public, max-age=60, stale-while-revalidate=600",
				"x-filspresso-data-source": "static-fallback",
			},
		});
	}
}
