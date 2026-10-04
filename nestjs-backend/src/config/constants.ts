export const DEFAULT_PORT = 4000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
export const DEFAULT_API_RATE_LIMIT_WINDOW_MS = 900_000;
export const DEFAULT_API_RATE_LIMIT_MAX = 1_200;

/**
 * Nest log levels, least to most verbose. `verbose` is included because it is the
 * level that exposes the request-timing lines Phase 0 instrumentation needs.
 */
export const VALID_LOG_LEVELS = ["verbose", "debug", "log", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof VALID_LOG_LEVELS)[number];
export const DEFAULT_LOG_LEVEL: LogLevel = "log";

/**
 * Resolves LOG_LEVEL, falling back to `log` for a missing or unrecognised value.
 * An invalid level must not silently disable logging.
 */
export function resolveLogLevel(raw: string | undefined): LogLevel {
	const candidate = String(raw ?? "").trim().toLowerCase();
	return (VALID_LOG_LEVELS as readonly string[]).includes(candidate)
		? (candidate as LogLevel)
		: DEFAULT_LOG_LEVEL;
}
