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

		// Resolve city & country from IP (done before cache check so it's always fresh per-request)
		const rawIp = req.headers["x-forwarded-for"] || req.ip || "";
		const clientIp = (Array.isArray(rawIp) ? rawIp[0] : rawIp.split(",")[0]).trim();
		let city = null;
		let country = null;
		try {
			// ip-api.com is free, no key required, no PII stored
			const geoUrl = `http://ip-api.com/json/${clientIp}?fields=city,country,status`;
			const geoRes = await fetch(geoUrl);
			if (geoRes.ok) {
				const geoData = await geoRes.json();
				if (geoData.status === "success") {
					city = geoData.city || null;
					country = geoData.country || null;
				}
			}
		} catch (_) {
			// geolocation failure is non-critical — fall back gracefully
		}

		const client = await pool.connect();
		try {
			// Check database cache
			const cacheResult = await client.query("SELECT data, timestamp FROM weather_cache WHERE cache_key = $1", [cacheKey]);

			if (cacheResult.rows.length > 0) {
				const cached = cacheResult.rows[0];
				const ageMinutes = (Date.now() - new Date(cached.timestamp).getTime()) / (1000 * 60);

				if (ageMinutes < CACHE_TTL_MINUTES) {
					// Serve cached weather but with fresh recommendation + location
					const cachedData = cached.data;
					const nowHour = new Date().getHours();
					return res.json({
						...cachedData,
						city,
						country,
						recommendation: getCoffeeRecommendation(
							cachedData.current?.temperature_2m,
							cachedData.current?.weather_code,
							nowHour,
						),
					});
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

			// Compute recommendation dynamically based on current time + weather
			const nowHour = new Date().getHours();
			const recommendation = getCoffeeRecommendation(json.current?.temperature_2m, json.current?.weather_code, nowHour);

			// Build the response — city/country are NOT stored in cache (they're per-IP)
			const rawOutput = {
				latitude: json.latitude,
				longitude: json.longitude,
				timezone: json.timezone,
				timezone_abbreviation: json.timezone_abbreviation,
				current: json.current || null,
				hourly: json.hourly || null,
			};

			// Update database cache with raw weather (no recommendation / no location)
			await client.query(
				`INSERT INTO weather_cache (cache_key, data, timestamp) 
				 VALUES ($1, $2, NOW()) 
				 ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, timestamp = NOW()`,
				[cacheKey, JSON.stringify(rawOutput)],
			);

			res.json({ ...rawOutput, city, country, recommendation });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Weather fetch error:", error);
		res.status(500).json({ error: "Failed to fetch weather data" });
	}
});

/**
 * Get coffee recommendation based on temperature, weather code, and hour of day.
 * @param {number|null} temperature  - current temperature in °C
 * @param {number|null} weatherCode  - WMO weather code
 * @param {number}      hour         - current hour (0-23) in local server time
 */
function getCoffeeRecommendation(temperature, weatherCode = 0, hour = new Date().getHours()) {
	if (temperature == null) return null;

	const isMorning = hour >= 5 && hour < 11; // 5–10 am
	const isAfternoon = hour >= 11 && hour < 17; // 11 am–4 pm
	const isEvening = hour >= 17 && hour < 22; // 5–9 pm
	const isNight = hour >= 22 || hour < 5; // 10 pm–4 am

	const isCold = temperature <= 8;
	const isCool = temperature > 8 && temperature <= 17;
	const isMild = temperature > 17 && temperature <= 24;
	const isWarm = temperature > 24;

	// Weather condition flags
	const isRainy = [51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode);
	const isSnowyStormy = [71, 73, 75, 77, 85, 86, 95, 96, 99].includes(weatherCode);
	const isSunny = [0, 1].includes(weatherCode);

	// Rainy/stormy days → comfort drinks regardless of temperature
	if (isSnowyStormy) {
		if (isMorning)
			return {
				type: "hot",
				drink: "Double Espresso",
				message: "Brave the snow with a powerful double espresso!",
				icon: "☕",
			};
		if (isAfternoon)
			return {
				type: "hot",
				drink: "Irish Coffee",
				message: "A warm Irish coffee is perfect for a stormy afternoon.",
				icon: "☕",
			};
		if (isEvening)
			return { type: "hot", drink: "Mocha", message: "Nothing beats a rich mocha on a snowy evening.", icon: "☕" };
		return {
			type: "hot",
			drink: "Ristretto",
			message: "A short, intense ristretto to warm you through the night.",
			icon: "☕",
		};
	}

	if (isRainy) {
		if (isMorning)
			return {
				type: "hot",
				drink: "Cappuccino",
				message: "Start your rainy morning with a creamy cappuccino.",
				icon: "☕",
			};
		if (isAfternoon)
			return { type: "hot", drink: "Flat White", message: "A smooth flat white to brighten a grey afternoon.", icon: "☕" };
		if (isEvening)
			return {
				type: "hot",
				drink: "Latte",
				message: "A warm latte — the perfect companion for a rainy evening.",
				icon: "🥛",
			};
		return { type: "hot", drink: "Lungo", message: "A slow lungo to wind down on a rainy night.", icon: "☕" };
	}

	// Cold temperatures (≤ 8 °C)
	if (isCold) {
		if (isMorning)
			return {
				type: "hot",
				drink: "Double Espresso",
				message: "Kick off a cold morning with a warming double espresso!",
				icon: "☕",
			};
		if (isAfternoon)
			return {
				type: "hot",
				drink: "Cappuccino",
				message: "Wrap your hands around a hot cappuccino this afternoon.",
				icon: "☕",
			};
		if (isEvening) return { type: "hot", drink: "Mocha", message: "A rich mocha is ideal for a cold evening.", icon: "☕" };
		return { type: "hot", drink: "Ristretto", message: "A bold ristretto to keep you warm late at night.", icon: "☕" };
	}

	// Cool temperatures (8–17 °C)
	if (isCool) {
		if (isMorning) return { type: "hot", drink: "Lungo", message: "A smooth lungo to ease into a cool morning.", icon: "☕" };
		if (isAfternoon && isSunny)
			return {
				type: "warm",
				drink: "Flat White",
				message: "A sunny but cool afternoon — perfect for a flat white.",
				icon: "☀️",
			};
		if (isAfternoon) return { type: "hot", drink: "Latte", message: "A comforting latte for a cool afternoon.", icon: "🥛" };
		if (isEvening)
			return { type: "hot", drink: "Cappuccino", message: "End your day with a classic cappuccino.", icon: "☕" };
		return { type: "hot", drink: "Espresso", message: "A quick espresso to energize the night.", icon: "☕" };
	}

	// Mild temperatures (17–24 °C)
	if (isMild) {
		if (isMorning)
			return { type: "warm", drink: "Latte", message: "A pleasant morning calls for a smooth latte.", icon: "🥛" };
		if (isAfternoon)
			return {
				type: "warm",
				drink: "Cortado",
				message: "Balance the mild afternoon with a perfectly balanced cortado.",
				icon: "☕",
			};
		if (isEvening)
			return {
				type: "cold",
				drink: "Iced Latte",
				message: "Cool down into the evening with a refreshing iced latte!",
				icon: "🧊",
			};
		return { type: "warm", drink: "Cold Brew", message: "A smooth cold brew to sip through the night.", icon: "❄️" };
	}

	// Warm temperatures (> 24 °C)
	if (isWarm) {
		if (isMorning)
			return {
				type: "cold",
				drink: "Iced Americano",
				message: "Beat the morning heat with a crisp iced americano!",
				icon: "🧊",
			};
		if (isAfternoon && isSunny)
			return {
				type: "cold",
				drink: "Cold Brew",
				message: "Hot sunny afternoon? A cold brew is your best friend.",
				icon: "❄️",
			};
		if (isAfternoon)
			return {
				type: "cold",
				drink: "Iced Cappuccino",
				message: "Stay cool this afternoon with an iced cappuccino.",
				icon: "🧊",
			};
		if (isEvening)
			return {
				type: "cold",
				drink: "Nitro Cold Brew",
				message: "Refresh your evening with a silky nitro cold brew.",
				icon: "❄️",
			};
		return {
			type: "cold",
			drink: "Iced Espresso",
			message: "A chilled iced espresso to keep you going through the night.",
			icon: "🧊",
		};
	}

	// Fallback
	return { type: "warm", drink: "Espresso", message: "A classic espresso — always a good idea.", icon: "☕" };
}

/**
 * GET /api/weather/recommendation
 * Returns just the coffee recommendation for the current weather
 */
router.get("/recommendation", async (req, res) => {
	try {
		const lat = parseFloat(req.query.lat) || DEFAULT_LAT;
		const lon = parseFloat(req.query.lon) || DEFAULT_LON;

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
		const code = json.current?.weather_code ?? 0;
		const hour = new Date().getHours();

		const output = {
			temperature: temp,
			weather_code: code,
			is_day: json.current?.is_day,
			recommendation: getCoffeeRecommendation(temp, code, hour),
		};

		res.json(output);
	} catch (error) {
		console.error("Recommendation fetch error:", error);
		res.status(500).json({ error: "Failed to fetch recommendation" });
	}
});

module.exports = router;
