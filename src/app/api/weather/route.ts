import { NextRequest, NextResponse } from "next/server";
import { buildBackendUrl, fetchJsonWithTimeout } from "@/lib/server/backend";
import type { WeatherData } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function fallbackWeather(): WeatherData {
	return {
		latitude: 44.4323,
		longitude: 26.1063,
		timezone: "Europe/Bucharest",
		timezone_abbreviation: "EET",
		city: "Bucharest",
		country: "Romania",
		current: {
			temperature_2m: 21,
			weather_code: 0,
			is_day: 1,
		},
		hourly: null,
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
		const data = await fetchJsonWithTimeout<WeatherData>(buildBackendUrl("/api/weather", request.nextUrl.search), {
			timeoutMs: 1500,
			cache: "no-store",
		});

		return NextResponse.json(data, {
			headers: {
				"Cache-Control": "public, max-age=300, stale-while-revalidate=900",
			},
		});
	} catch {
		return NextResponse.json(fallbackWeather(), {
			headers: {
				"Cache-Control": "public, max-age=60, stale-while-revalidate=600",
				"x-filspresso-data-source": "static-fallback",
			},
		});
	}
}
