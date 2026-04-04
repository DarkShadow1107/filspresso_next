export const CURRENCY_CONFIG = {
	RON: { label: "Romanian Leu", symbol: "RON", feePercent: 0 },
	EUR: { label: "Euro", symbol: "EUR", feePercent: 5 },
	CZK: { label: "Czech Koruna", symbol: "CZK", feePercent: 8 },
	DKK: { label: "Danish Krone", symbol: "DKK", feePercent: 10 },
	PLN: { label: "Polish Złoty", symbol: "PLN", feePercent: 9 },
	CHF: { label: "Swiss Franc", symbol: "CHF", feePercent: 15 },
	TRY: { label: "Turkish Lira", symbol: "TRY", feePercent: 25 },
} as const;

export type SupportedCurrencyCode = keyof typeof CURRENCY_CONFIG;

export const SUPPORTED_DESTINATIONS = [
	{ code: "AT", name: "Austria", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "BE", name: "Belgium", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "BG", name: "Bulgaria", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "HR", name: "Croatia", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "CY", name: "Cyprus", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "RO", name: "Romania", defaultCurrency: "RON", shippingRegion: "eu" },
	{ code: "CZ", name: "Czechia", defaultCurrency: "CZK", shippingRegion: "eu" },
	{ code: "DK", name: "Denmark", defaultCurrency: "DKK", shippingRegion: "eu" },
	{ code: "EE", name: "Estonia", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "FI", name: "Finland", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "FR", name: "France", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "DE", name: "Germany", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "GR", name: "Greece", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "HU", name: "Hungary", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "IE", name: "Ireland", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "IT", name: "Italy", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "LV", name: "Latvia", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "LT", name: "Lithuania", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "LU", name: "Luxembourg", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "MT", name: "Malta", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "NL", name: "Netherlands", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "PL", name: "Poland", defaultCurrency: "PLN", shippingRegion: "eu" },
	{ code: "PT", name: "Portugal", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "SK", name: "Slovakia", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "SI", name: "Slovenia", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "ES", name: "Spain", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "SE", name: "Sweden", defaultCurrency: "EUR", shippingRegion: "eu" },
	{ code: "CH", name: "Switzerland", defaultCurrency: "CHF", shippingRegion: "exception" },
	{ code: "TR", name: "Turkey", defaultCurrency: "TRY", shippingRegion: "exception" },
] as const;

export type SupportedDestination = (typeof SUPPORTED_DESTINATIONS)[number];

export const FX_FETCH_CODES = Object.keys(CURRENCY_CONFIG)
	.filter((code) => code !== "RON")
	.join(",");

// Conservative fallback rates (RON base) used when live FX providers are unavailable.
export const FALLBACK_FX_RATES: Record<SupportedCurrencyCode, number> = {
	RON: 1,
	EUR: 0.2,
	CZK: 5.05,
	DKK: 1.49,
	PLN: 0.86,
	CHF: 0.19,
	TRY: 7.01,
};

export function sanitizeFxRates(
	rates: Partial<Record<SupportedCurrencyCode, number>> | undefined,
): Partial<Record<SupportedCurrencyCode, number>> {
	if (!rates) return {};

	const sanitized: Partial<Record<SupportedCurrencyCode, number>> = {};
	for (const key of Object.keys(CURRENCY_CONFIG) as SupportedCurrencyCode[]) {
		if (key === "RON") continue;
		const value = Number(rates[key]);
		if (Number.isFinite(value) && value > 0) {
			sanitized[key] = value;
		}
	}

	return sanitized;
}

export function roundCurrency(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number, currencyCode: string): string {
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: currencyCode,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(value);
	} catch {
		return `${value.toFixed(2)} ${currencyCode}`;
	}
}
