export const DEFAULT_PORT = 4000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
export const DEFAULT_API_RATE_LIMIT_WINDOW_MS = 900_000;
export const DEFAULT_API_RATE_LIMIT_MAX = 1_200;

export const GLOBAL_RATE_LIMIT_EXCLUDED_PATHS = new Set([
	"/auth/login",
	"/auth/register",
	"/admin/login",
	"/kafelot/check-and-use",
	"/kafelot/status",
]);
