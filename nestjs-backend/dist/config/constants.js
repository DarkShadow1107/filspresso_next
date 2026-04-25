"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLOBAL_RATE_LIMIT_EXCLUDED_PATHS = exports.DEFAULT_API_RATE_LIMIT_MAX = exports.DEFAULT_API_RATE_LIMIT_WINDOW_MS = exports.DEFAULT_REQUEST_TIMEOUT_MS = exports.DEFAULT_PORT = void 0;
exports.DEFAULT_PORT = 4000;
exports.DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
exports.DEFAULT_API_RATE_LIMIT_WINDOW_MS = 900_000;
exports.DEFAULT_API_RATE_LIMIT_MAX = 1_200;
exports.GLOBAL_RATE_LIMIT_EXCLUDED_PATHS = new Set([
    "/auth/login",
    "/auth/register",
    "/admin/login",
    "/kafelot/check-and-use",
    "/kafelot/status",
]);
