/**
 * Weather utility functions for frontend
 * Fetches weather data from the Express API proxy
 */

export type WeatherRecommendation = {
	type: "hot" | "warm" | "cold";
	drink: string;
	message: string;
	icon: string;
};

export type CurrentWeather = {
	temperature_2m: number;
	weather_code: number;
	is_day: number;
};

export type HourlyWeather = {
	time: string[];
	temperature_2m: number[];
	precipitation: number[];
	precipitation_probability: number[];
	weather_code: number[];
};

export type WeatherData = {
	latitude: number;
	longitude: number;
	timezone: string;
	timezone_abbreviation: string;
	current: CurrentWeather | null;
	hourly: HourlyWeather | null;
	recommendation: WeatherRecommendation | null;
};

export type WeatherRecommendationData = {
	temperature: number;
	weather_code: number;
	is_day: number;
	recommendation: WeatherRecommendation | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Fetch full weather data including hourly forecast
 */
export async function getWeather(lat = 44.4323, lon = 26.1063): Promise<WeatherData> {
	const res = await fetch(`${API_BASE}/api/weather?lat=${lat}&lon=${lon}`, {
		next: { revalidate: 600 }, // Cache for 10 minutes in Next.js
	});

	if (!res.ok) {
		throw new Error("Failed to fetch weather data");
	}

	return res.json();
}

/**
 * Fetch just the coffee recommendation based on current weather
 */
export async function getWeatherRecommendation(lat = 44.4323, lon = 26.1063): Promise<WeatherRecommendationData> {
	const res = await fetch(`${API_BASE}/api/weather/recommendation?lat=${lat}&lon=${lon}`, {
		next: { revalidate: 600 },
	});

	if (!res.ok) {
		throw new Error("Failed to fetch weather recommendation");
	}

	return res.json();
}

/**
 * Get weather description from WMO weather code
 */
export function getWeatherDescription(code: number): string {
	const descriptions: Record<number, string> = {
		0: "Clear sky",
		1: "Mainly clear",
		2: "Partly cloudy",
		3: "Overcast",
		45: "Foggy",
		48: "Depositing rime fog",
		51: "Light drizzle",
		53: "Moderate drizzle",
		55: "Dense drizzle",
		61: "Slight rain",
		63: "Moderate rain",
		65: "Heavy rain",
		66: "Light freezing rain",
		67: "Heavy freezing rain",
		71: "Slight snow",
		73: "Moderate snow",
		75: "Heavy snow",
		77: "Snow grains",
		80: "Slight rain showers",
		81: "Moderate rain showers",
		82: "Violent rain showers",
		85: "Slight snow showers",
		86: "Heavy snow showers",
		95: "Thunderstorm",
		96: "Thunderstorm with slight hail",
		99: "Thunderstorm with heavy hail",
	};

	return descriptions[code] || "Unknown";
}

/**
 * Get weather icon based on WMO weather code and day/night
 */
export function getWeatherIcon(code: number, isDay: boolean = true): string {
	if (code === 0) return isDay ? "☀️" : "🌙";
	if (code <= 3) return isDay ? "⛅" : "☁️";
	if (code <= 48) return "🌫️";
	if (code <= 55) return "🌧️";
	if (code <= 67) return "🌧️";
	if (code <= 77) return "❄️";
	if (code <= 82) return "🌧️";
	if (code <= 86) return "🌨️";
	if (code >= 95) return "⛈️";
	return "🌤️";
}

/**
 * Check if weather might cause shipping delays
 */
export function hasShippingRisk(weather: WeatherData): { risk: boolean; message: string } {
	if (!weather.current) {
		return { risk: false, message: "" };
	}

	const code = weather.current.weather_code;

	// Heavy precipitation or storms
	if (code >= 63 && code <= 67) {
		return { risk: true, message: "Heavy rain may cause slight shipping delays." };
	}
	if (code >= 73 && code <= 77) {
		return { risk: true, message: "Snow conditions may affect delivery times." };
	}
	if (code >= 82) {
		return { risk: true, message: "Severe weather may impact shipping schedules." };
	}
	if (code >= 95) {
		return { risk: true, message: "Thunderstorms in the area - deliveries may be delayed." };
	}

	return { risk: false, message: "" };
}
