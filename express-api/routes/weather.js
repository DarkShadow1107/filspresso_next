/**
 * Weather API Route
 * Proxies Open-Meteo API with server-side caching to avoid rate limits
 * and provide a simple interface for the frontend.
 */

const express = require("express");
const pool = require("../db/connection");
const router = express.Router();

const CACHE_TTL_MINUTES = 10;

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

		const client = await pool.connect();
		try {
			// Check database cache
			const cacheResult = await client.query("SELECT data, timestamp FROM weather_cache WHERE cache_key = $1", [cacheKey]);

			if (cacheResult.rows.length > 0) {
				const cached = cacheResult.rows[0];
				const ageMinutes = (Date.now() - new Date(cached.timestamp).getTime()) / (1000 * 60);

				if (ageMinutes < CACHE_TTL_MINUTES) {
					return res.json(cached.data);
				}
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

			// Update database cache
			await client.query(
				`INSERT INTO weather_cache (cache_key, data, timestamp) 
				 VALUES ($1, $2, NOW()) 
				 ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, timestamp = NOW()`,
				[cacheKey, JSON.stringify(output)]
			);

			res.json(output);
		} finally {
			client.release();
		}
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
