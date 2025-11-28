"use client";

import { useEffect, useState } from "react";
import type { WeatherData, WeatherRecommendation } from "@/lib/weather";
import { getWeatherIcon, getWeatherDescription } from "@/lib/weather";

type WeatherWidgetProps = {
	weather?: WeatherData | null;
	compact?: boolean;
	showRecommendation?: boolean;
	className?: string;
};

export default function WeatherWidget({
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
			try {
				const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
				const res = await fetch(`${API_BASE}/api/weather`);
				if (!res.ok) throw new Error("Failed to fetch weather");
				const data = await res.json();
				setWeather(data);
			} catch (err) {
				setError("Weather unavailable");
				console.error("Weather fetch error:", err);
			} finally {
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
	const icon = getWeatherIcon(weather.current.weather_code, weather.current.is_day === 1);
	const description = getWeatherDescription(weather.current.weather_code);
	const recommendation = weather.recommendation;

	if (compact) {
		return (
			<div className={`weather-widget weather-widget--compact ${className}`}>
				<span className="weather-widget__icon">{icon}</span>
				<span className="weather-widget__temp">{temp}°C</span>
				{recommendation && (
					<span className="weather-widget__rec-icon" title={recommendation.message}>
						{recommendation.icon}
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
			return { icon: "❄️", estimate: "3-5 days", message: "Snow may delay deliveries" };
		}
		// Rain codes: 51-67, 80-82, 95-99
		if ([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(weatherCode)) {
			return { icon: "🌧️", estimate: "2-3 days", message: "Rain may cause slight delays" };
		}
		// Clear weather
		return { icon: "📦", estimate: "1-2 days", message: "Perfect conditions for fast delivery" };
	};

	const shippingInfo = getShippingInfo();

	return (
		<div className={`weather-widget ${className}`}>
			<div className="weather-widget__current">
				<div className="weather-widget__icon-large">{icon}</div>
				<div className="weather-widget__info">
					<div className="weather-widget__temp-large">{temp}°C</div>
					<div className="weather-widget__desc">{description}</div>
					<div className="weather-widget__location">{weather.timezone_abbreviation}</div>
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
						<span className="weather-widget__rec-icon-large">{recommendation.icon}</span>
						<span className="weather-widget__rec-drink">{recommendation.drink}</span>
					</div>
					<p className="weather-widget__rec-message">{recommendation.message}</p>
				</div>
			)}
		</div>
	);
}

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
