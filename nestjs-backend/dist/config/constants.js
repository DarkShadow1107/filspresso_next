"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_LOG_LEVEL = exports.VALID_LOG_LEVELS = exports.DEFAULT_API_RATE_LIMIT_MAX = exports.DEFAULT_API_RATE_LIMIT_WINDOW_MS = exports.DEFAULT_REQUEST_TIMEOUT_MS = exports.DEFAULT_PORT = void 0;
exports.resolveLogLevel = resolveLogLevel;
exports.DEFAULT_PORT = 4000;
exports.DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
exports.DEFAULT_API_RATE_LIMIT_WINDOW_MS = 900_000;
exports.DEFAULT_API_RATE_LIMIT_MAX = 1_200;
/**
 * Nest log levels, least to most verbose. `verbose` is included because it is the
 * level that exposes the request-timing lines Phase 0 instrumentation needs.
 */
exports.VALID_LOG_LEVELS = ["verbose", "debug", "log", "warn", "error", "fatal"];
exports.DEFAULT_LOG_LEVEL = "log";
/**
 * Resolves LOG_LEVEL, falling back to `log` for a missing or unrecognised value.
 * An invalid level must not silently disable logging.
 */
function resolveLogLevel(raw) {
    const candidate = String(raw ?? "").trim().toLowerCase();
    return exports.VALID_LOG_LEVELS.includes(candidate)
        ? candidate
        : exports.DEFAULT_LOG_LEVEL;
}
