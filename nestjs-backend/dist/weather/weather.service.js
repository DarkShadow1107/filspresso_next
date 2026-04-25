"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WeatherService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const DEFAULT_LAT = 44.4323;
const DEFAULT_LON = 26.1063;
const CACHE_TTL_MINUTES = 10;
function getCoffeeRecommendation(temperature, weatherCode = 0, hour = new Date().getHours()) {
    if (temperature == null)
        return null;
    const isMorning = hour >= 5 && hour < 11;
    const isAfternoon = hour >= 11 && hour < 17;
    const isEvening = hour >= 17 && hour < 22;
    const isCold = temperature <= 8;
    const isCool = temperature > 8 && temperature <= 17;
    const isMild = temperature > 17 && temperature <= 24;
    const isWarm = temperature > 24;
    const isRainy = [51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode);
    const isSnowyStormy = [71, 73, 75, 77, 85, 86, 95, 96, 99].includes(weatherCode);
    const isSunny = [0, 1].includes(weatherCode);
    if (isSnowyStormy) {
        if (isMorning)
            return { type: "hot", drink: "Double Espresso", message: "Brave the snow with a powerful double espresso!", icon: "☕" };
        if (isAfternoon)
            return { type: "hot", drink: "Irish Coffee", message: "A warm Irish coffee is perfect for a stormy afternoon.", icon: "☕" };
        if (isEvening)
            return { type: "hot", drink: "Mocha", message: "Nothing beats a rich mocha on a snowy evening.", icon: "☕" };
        return { type: "hot", drink: "Ristretto", message: "A short, intense ristretto to warm you through the night.", icon: "☕" };
    }
    if (isRainy) {
        if (isMorning)
            return { type: "hot", drink: "Cappuccino", message: "Start your rainy morning with a creamy cappuccino.", icon: "☕" };
        if (isAfternoon)
            return { type: "hot", drink: "Flat White", message: "A smooth flat white to brighten a grey afternoon.", icon: "☕" };
        if (isEvening)
            return { type: "hot", drink: "Latte", message: "A warm latte — the perfect companion for a rainy evening.", icon: "🥛" };
        return { type: "hot", drink: "Lungo", message: "A slow lungo to wind down on a rainy night.", icon: "☕" };
    }
    if (isCold) {
        if (isMorning)
            return { type: "hot", drink: "Double Espresso", message: "Kick off a cold morning with a warming double espresso!", icon: "☕" };
        if (isAfternoon)
            return { type: "hot", drink: "Cappuccino", message: "Wrap your hands around a hot cappuccino this afternoon.", icon: "☕" };
        if (isEvening)
            return { type: "hot", drink: "Mocha", message: "A rich mocha is ideal for a cold evening.", icon: "☕" };
        return { type: "hot", drink: "Ristretto", message: "A bold ristretto to keep you warm late at night.", icon: "☕" };
    }
    if (isCool) {
        if (isMorning)
            return { type: "hot", drink: "Lungo", message: "A smooth lungo to ease into a cool morning.", icon: "☕" };
        if (isAfternoon && isSunny)
            return { type: "warm", drink: "Flat White", message: "A sunny but cool afternoon — perfect for a flat white.", icon: "☀️" };
        if (isAfternoon)
            return { type: "hot", drink: "Latte", message: "A comforting latte for a cool afternoon.", icon: "🥛" };
        if (isEvening)
            return { type: "hot", drink: "Cappuccino", message: "End your day with a classic cappuccino.", icon: "☕" };
        return { type: "hot", drink: "Espresso", message: "A quick espresso to energize the night.", icon: "☕" };
    }
    if (isMild) {
        if (isMorning)
            return { type: "warm", drink: "Latte", message: "A pleasant morning calls for a smooth latte.", icon: "🥛" };
        if (isAfternoon)
            return { type: "warm", drink: "Cortado", message: "Balance the mild afternoon with a perfectly balanced cortado.", icon: "☕" };
        if (isEvening)
            return { type: "cold", drink: "Iced Latte", message: "Cool down into the evening with a refreshing iced latte!", icon: "🧊" };
        return { type: "warm", drink: "Cold Brew", message: "A smooth cold brew to sip through the night.", icon: "❄️" };
    }
    if (isWarm) {
        if (isMorning)
            return { type: "cold", drink: "Iced Americano", message: "Beat the morning heat with a crisp iced americano!", icon: "🧊" };
        if (isAfternoon && isSunny)
            return { type: "cold", drink: "Cold Brew", message: "Hot sunny afternoon? A cold brew is your best friend.", icon: "❄️" };
        if (isAfternoon)
            return { type: "cold", drink: "Iced Cappuccino", message: "Stay cool this afternoon with an iced cappuccino.", icon: "🧊" };
        if (isEvening)
            return { type: "cold", drink: "Nitro Cold Brew", message: "Refresh your evening with a silky nitro cold brew.", icon: "❄️" };
        return { type: "cold", drink: "Iced Espresso", message: "A chilled iced espresso to keep you going through the night.", icon: "🧊" };
    }
    return { type: "warm", drink: "Espresso", message: "A classic espresso — always a good idea.", icon: "☕" };
}
let WeatherService = class WeatherService {
    db;
    constructor(db) {
        this.db = db;
    }
    async getWeather(lat, lon, clientIp) {
        const safeLat = Number.isFinite(lat) ? lat : DEFAULT_LAT;
        const safeLon = Number.isFinite(lon) ? lon : DEFAULT_LON;
        const cacheKey = `${safeLat.toFixed(2)}:${safeLon.toFixed(2)}`;
        let city = null;
        let country = null;
        try {
            const geoRes = await fetch(`http://ip-api.com/json/${clientIp}?fields=city,country,status`);
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                if (geoData.status === "success") {
                    city = geoData.city || null;
                    country = geoData.country || null;
                }
            }
        }
        catch { /* geo is non-critical */ }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const cached = await client.query("SELECT data, timestamp FROM weather_cache WHERE cache_key = $1", [cacheKey]);
            if (cached.rows[0]) {
                const ageMinutes = (Date.now() - new Date(String(cached.rows[0].timestamp)).getTime()) / 60000;
                if (ageMinutes < CACHE_TTL_MINUTES) {
                    const data = cached.rows[0].data;
                    const nowHour = new Date().getHours();
                    const current = data.current;
                    return { ...data, city, country, recommendation: getCoffeeRecommendation(current?.temperature_2m ?? null, current?.weather_code ?? 0, nowHour) };
                }
            }
            const url = new URL("https://api.open-meteo.com/v1/forecast");
            url.searchParams.set("latitude", safeLat.toString());
            url.searchParams.set("longitude", safeLon.toString());
            url.searchParams.set("hourly", "temperature_2m,precipitation,precipitation_probability,weather_code");
            url.searchParams.set("current", "temperature_2m,weather_code,is_day");
            url.searchParams.set("timezone", "auto");
            url.searchParams.set("forecast_days", "2");
            const response = await fetch(url.toString());
            if (!response.ok)
                throw new common_1.BadRequestException({ error: "Weather API unavailable" });
            const json = await response.json();
            const nowHour = new Date().getHours();
            const current = json.current;
            const rawOutput = {
                latitude: json.latitude, longitude: json.longitude, timezone: json.timezone,
                timezone_abbreviation: json.timezone_abbreviation, current: json.current || null, hourly: json.hourly || null,
            };
            await client.query(`INSERT INTO weather_cache (cache_key, data, timestamp) VALUES ($1, $2, NOW())
         ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, timestamp = NOW()`, [cacheKey, JSON.stringify(rawOutput)]);
            return { ...rawOutput, city, country, recommendation: getCoffeeRecommendation(current?.temperature_2m ?? null, current?.weather_code ?? 0, nowHour) };
        }
        finally {
            client.release();
        }
    }
    async getRecommendation(lat, lon) {
        const safeLat = Number.isFinite(lat) ? lat : DEFAULT_LAT;
        const safeLon = Number.isFinite(lon) ? lon : DEFAULT_LON;
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set("latitude", safeLat.toString());
        url.searchParams.set("longitude", safeLon.toString());
        url.searchParams.set("current", "temperature_2m,weather_code,is_day");
        url.searchParams.set("timezone", "auto");
        const response = await fetch(url.toString());
        if (!response.ok)
            throw new common_1.BadRequestException({ error: "Weather API unavailable" });
        const json = await response.json();
        const current = json.current;
        const temp = current?.temperature_2m ?? null;
        const code = current?.weather_code ?? 0;
        return { temperature: temp, weather_code: code, is_day: current?.is_day, recommendation: getCoffeeRecommendation(temp, code) };
    }
};
exports.WeatherService = WeatherService;
exports.WeatherService = WeatherService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], WeatherService);
