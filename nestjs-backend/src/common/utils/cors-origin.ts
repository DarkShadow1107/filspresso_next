export function parseConfiguredOrigins(rawOrigins: string): string[] {
	return String(rawOrigins || "")
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);
}

export function allowLocalhostOrigin(origin: string): boolean {
	return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

export function isAllowedCorsOrigin(origin: string, configuredOrigins: string[], isProduction: boolean): boolean {
	if (!origin) return true;
	if (configuredOrigins.includes(origin)) return true;
	if (!isProduction && allowLocalhostOrigin(origin)) return true;
	return false;
}
