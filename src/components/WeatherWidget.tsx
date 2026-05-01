"use client";

import React, { useEffect, useState } from "react";
import type { WeatherData, WeatherRecommendation } from "@/lib/weather";
import { getWeatherIcon, getWeatherDescription } from "@/lib/weather";
import {
	MoonIcon,
	BrightnessDownIcon,
	TriangleAlertIcon,
	TruckElectricIcon,
	CoffeeIcon,
	BrandAwsIcon,
	SparklesIcon,
	FlameIcon,
	SunIcon,
	CloudIcon,
	RainIcon,
	SnowIcon,
    CloudFogIcon,
    CloudDrizzleIcon,
    CloudLightningIcon,
    WindIcon,
    MoonStarIcon,
    CloudMoonIcon,
    CloudSunIcon,
    CloudSunRainIcon,
    SunFogIcon,
} from "@/icons";

type WeatherWidgetProps = {
	weather?: WeatherData | null;
	compact?: boolean;
	showRecommendation?: boolean;
	className?: string;
};

const WeatherIcon = ({ icon, size }: { icon: string; size: number }) => {
	const iconMap: Record<string, React.ElementType> = {
		"clear-day": SunIcon,
		"clear-night": MoonStarIcon,
		"partly-cloudy-day": CloudSunIcon,
		"partly-cloudy-night": CloudMoonIcon,
		cloudy: CloudIcon,
		fog: CloudFogIcon,
        mist: CloudFogIcon,
		drizzle: CloudDrizzleIcon,
		rain: RainIcon,
		"rain-showers": CloudSunRainIcon,
		snow: SnowIcon,
		"snow-showers": SnowIcon,
		thunderstorm: CloudLightningIcon,
        windy: WindIcon,
        "sun-fog": SunFogIcon, // Additional fallback
	};
	const IconComp = iconMap[icon] || SunIcon;
	return <IconComp size={size} />;
};

const WEATHER_CACHE_KEY = "filspresso_weather_snapshot";
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;

function readCachedWeather(): WeatherData | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.sessionStorage.getItem(WEATHER_CACHE_KEY);
		if (!raw) return null;
		const cached = JSON.parse(raw) as { timestamp: number; data: WeatherData };
		if (!cached?.data || Date.now() - cached.timestamp > WEATHER_CACHE_TTL_MS) return null;
		return cached.data;
	} catch {
		return null;
	}
}

function writeCachedWeather(data: WeatherData) {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
	} catch {
		// Storage is an optional speed cache.
	}
}

const WeatherWidget = React.memo(function WeatherWidget({
	weather: initialWeather,
	compact = false,
	showRecommendation = true,
	className = "",
}: WeatherWidgetProps) {
	const [weather, setWeather] = useState<WeatherData | null>(initialWeather || null);
	const [loading, setLoading] = useState(!initialWeather);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (initialWeather) {
			setWeather(initialWeather);
			setLoading(false);
			return;
		}

		const fetchWeather = async () => {
			const cached = readCachedWeather();
			if (cached) {
				setWeather(cached);
				setLoading(false);
			}

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 2500);
			try {
				const API_BASE = typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";
				const res = await fetch(`${API_BASE}/api/weather`, {
					cache: "force-cache",
					signal: controller.signal,
				});
				if (!res.ok) throw new Error("Failed to fetch weather");
				const data = await res.json();
				setWeather(data);
				writeCachedWeather(data);
			} catch (err) {
				setError("Weather unavailable");
				if (process.env.NODE_ENV !== "production") {
					console.warn("Weather unavailable; using cached or hidden widget.", err);
				}
			} finally {
				clearTimeout(timeout);
				setLoading(false);
			}
		};

		fetchWeather();
	}, [initialWeather]);

	if (loading) {
		return (
			<div className={`weather-widget weather-widget--loading ${className}`}>
				<div className="weather-widget__skeleton" />
			</div>
		);
	}

	if (error || !weather?.current) {
		return null; // Gracefully hide on error
	}

	const temp = Math.round(weather.current.temperature_2m);
	const iconLabel = getWeatherIcon(weather.current.weather_code, weather.current.is_day === 1);
	const description = getWeatherDescription(weather.current.weather_code);
	const recommendation = weather.recommendation;

	// Build location label: "City, Country", or parse the IANA timezone, or fall back to abbreviation
	const locationLabel =
		weather.city && weather.country
			? `${weather.city}, ${weather.country}`
			: weather.timezone
				? (weather.timezone.split("/").pop()?.replace(/_/g, " ") ?? weather.timezone_abbreviation)
				: weather.timezone_abbreviation;

	// Local time formatted using the IANA timezone from Open-Meteo
	const localTime = weather.timezone
		? new Date().toLocaleTimeString("en-US", {
				timeZone: weather.timezone,
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			})
		: null;

	if (compact) {
		return (
			<div className={`weather-widget weather-widget--compact ${className}`}>
				<span className="weather-widget__icon">
					<WeatherIcon icon={iconLabel} size={19} />
				</span>
				<span className="weather-widget__temp">{temp}°C</span>
				{recommendation && (
					<span className="weather-widget__rec-icon" title={recommendation.message}>
						<WeatherIcon icon={recommendation.icon} size={15} />
					</span>
				)}
			</div>
		);
	}

	// Determine shipping estimate based on weather code
	const getShippingInfo = () => {
		const weatherCode = weather.current?.weather_code ?? 0;
		// Snow codes: 71-77, 85-86
		if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
			return { icon: <TriangleAlertIcon size={16} />, estimate: "3-5 days", message: "Snow may delay deliveries" };
		}
		// Rain codes: 51-67, 80-82, 95-99
		if ([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(weatherCode)) {
			return { icon: <TriangleAlertIcon size={16} />, estimate: "2-3 days", message: "Rain may cause slight delays" };
		}
		// Clear weather
		return { icon: <TruckElectricIcon size={16} />, estimate: "1-2 days", message: "Perfect conditions for fast delivery" };
	};

	const shippingInfo = getShippingInfo();

	return (
		<div className={`weather-widget ${className}`}>
			<div className="weather-widget__current">
				<div className="weather-widget__icon-large">
					<WeatherIcon icon={iconLabel} size={45} />
				</div>
				<div className="weather-widget__info">
					<div className="weather-widget__temp-large">{temp}°C</div>
					<div className="weather-widget__desc">{description}</div>
					<div className="weather-widget__location">
						{locationLabel}
						{localTime && <span className="weather-widget__time"> · {localTime}</span>}
					</div>
				</div>
			</div>

			{/* Shipping info based on weather */}
			<div className="weather-widget__shipping">
				<div className="weather-widget__shipping-header">
					<span className="weather-widget__shipping-icon">{shippingInfo.icon}</span>
					<span className="weather-widget__shipping-estimate">Shipping: {shippingInfo.estimate}</span>
				</div>
				<p className="weather-widget__shipping-message">{shippingInfo.message}</p>
			</div>

			{showRecommendation && recommendation && (
				<div className="weather-widget__recommendation">
					<div className="weather-widget__rec-header">
						<span className="weather-widget__rec-icon-large">
							<CoffeeIcon size={24} />
						</span>
						<span className="weather-widget__rec-drink">{recommendation.drink}</span>
					</div>
					<p className="weather-widget__rec-message">{recommendation.message}</p>
				</div>
			)}
		</div>
	);
});

export default WeatherWidget;

/**
 * Compact weather chip for headers/navbars
 */
export function WeatherChip({ className = "" }: { className?: string }) {
	return <WeatherWidget compact showRecommendation={false} className={className} />;
}

/**
 * Coffee recommendation based on weather
 */
export function CoffeeWeatherRecommendation({
	recommendation,
	className = "",
}: {
	recommendation?: WeatherRecommendation | null;
	className?: string;
}) {
	if (!recommendation) return null;

	return (
		<div className={`coffee-weather-rec ${className}`}>
			<div className="coffee-weather-rec__icon">{recommendation.icon}</div>
			<div className="coffee-weather-rec__content">
				<div className="coffee-weather-rec__drink">{recommendation.drink}</div>
				<p className="coffee-weather-rec__message">{recommendation.message}</p>
			</div>
		</div>
	);
}
