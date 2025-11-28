/**
 * Weather API Route
 * Proxies Open-Meteo API with server-side caching to avoid rate limits
 * and provide a simple interface for the frontend.
 */

const express = require("express");
const router = express.Router();

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Default coordinates (Bucharest, Romania)
const DEFAULT_LAT = 44.4323;
const DEFAULT_LON = 26.1063;

/**
 * GET /api/weather
 * Query params:
 *   - lat: latitude (default: 44.4323)
 *   - lon: longitude (default: 26.1063)
 *
 * Returns hourly weather data including temperature, precipitation, and probability
 */
router.get("/", async (req, res) => {
	try {
		const lat = parseFloat(req.query.lat) || DEFAULT_LAT;
		const lon = parseFloat(req.query.lon) || DEFAULT_LON;

		// Round to 2 decimal places for cache key consistency
		const cacheKey = `${lat.toFixed(2)}:${lon.toFixed(2)}`;

		// Check cache
		const cached = cache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
			return res.json(cached.data);
		}

		// Fetch from Open-Meteo API
		const url = new URL("https://api.open-meteo.com/v1/forecast");
		url.searchParams.set("latitude", lat.toString());
		url.searchParams.set("longitude", lon.toString());
		url.searchParams.set("hourly", "temperature_2m,precipitation,precipitation_probability,weather_code");
		url.searchParams.set("current", "temperature_2m,weather_code,is_day");
		url.searchParams.set("timezone", "auto");
		url.searchParams.set("forecast_days", "2");

		const response = await fetch(url.toString());

		if (!response.ok) {
			console.error("Open-Meteo API error:", response.status, response.statusText);
			return res.status(502).json({ error: "Weather API unavailable" });
		}

		const json = await response.json();

		// Build simplified response
		const output = {
			latitude: json.latitude,
			longitude: json.longitude,
			timezone: json.timezone,
			timezone_abbreviation: json.timezone_abbreviation,
			current: json.current || null,
			hourly: json.hourly || null,
			// Add coffee recommendation based on current temperature
			recommendation: getCoffeeRecommendation(json.current?.temperature_2m),
		};

		// Cache the result
		cache.set(cacheKey, { data: output, timestamp: Date.now() });

		res.json(output);
	} catch (error) {
		console.error("Weather fetch error:", error);
		res.status(500).json({ error: "Failed to fetch weather data" });
	}
});

/**
 * Get coffee recommendation based on temperature
 */
function getCoffeeRecommendation(temperature) {
	if (temperature == null) return null;

	if (temperature <= 5) {
		return {
			type: "hot",
			drink: "Double Espresso",
			message: "Perfect weather for a warming double espresso!",
			icon: "☕",
		};
	} else if (temperature <= 15) {
		return {
			type: "hot",
			drink: "Cappuccino",
			message: "A creamy cappuccino would be ideal right now.",
			icon: "☕",
		};
	} else if (temperature <= 22) {
		return {
			type: "warm",
			drink: "Latte",
			message: "Nice weather for a smooth latte.",
			icon: "🥛",
		};
	} else if (temperature <= 28) {
		return {
			type: "cold",
			drink: "Iced Latte",
			message: "Cool down with a refreshing iced latte!",
			icon: "🧊",
		};
	} else {
		return {
			type: "cold",
			drink: "Cold Brew",
			message: "Beat the heat with our cold brew coffee!",
			icon: "❄️",
		};
	}
}

/**
 * GET /api/weather/recommendation
 * Returns just the coffee recommendation for the current weather
 */
router.get("/recommendation", async (req, res) => {
	try {
		const lat = parseFloat(req.query.lat) || DEFAULT_LAT;
		const lon = parseFloat(req.query.lon) || DEFAULT_LON;

		const cacheKey = `rec:${lat.toFixed(2)}:${lon.toFixed(2)}`;

		const cached = cache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
			return res.json(cached.data);
		}

		const url = new URL("https://api.open-meteo.com/v1/forecast");
		url.searchParams.set("latitude", lat.toString());
		url.searchParams.set("longitude", lon.toString());
		url.searchParams.set("current", "temperature_2m,weather_code,is_day");
		url.searchParams.set("timezone", "auto");

		const response = await fetch(url.toString());

		if (!response.ok) {
			return res.status(502).json({ error: "Weather API unavailable" });
		}

		const json = await response.json();
		const temp = json.current?.temperature_2m;

		const output = {
			temperature: temp,
			weather_code: json.current?.weather_code,
			is_day: json.current?.is_day,
			recommendation: getCoffeeRecommendation(temp),
		};

		cache.set(cacheKey, { data: output, timestamp: Date.now() });
		res.json(output);
	} catch (error) {
		console.error("Recommendation fetch error:", error);
		res.status(500).json({ error: "Failed to fetch recommendation" });
	}
});

module.exports = router;
