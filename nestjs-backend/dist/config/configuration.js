"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("./constants");
function toBoolean(value, fallback) {
    if (value === undefined)
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === "true" || normalized === "1")
        return true;
    if (normalized === "false" || normalized === "0")
        return false;
    return fallback;
}
function toNumber(value, fallback, min, max) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(Math.max(parsed, min), max);
}
exports.default = () => ({
    nodeEnv: process.env.NODE_ENV || "production",
    port: toNumber(process.env.PORT, constants_1.DEFAULT_PORT, 1, 65535),
    trustProxy: process.env.TRUST_PROXY,
    requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, constants_1.DEFAULT_REQUEST_TIMEOUT_MS, 5_000, 120_000),
    corsOrigin: String(process.env.CORS_ORIGIN || "http://localhost:3000"),
    backendPublicUrl: String(process.env.BACKEND_PUBLIC_URL || "http://localhost:4000"),
    apiRateLimitWindowMs: toNumber(process.env.API_RATE_LIMIT_WINDOW_MS, constants_1.DEFAULT_API_RATE_LIMIT_WINDOW_MS, 60_000, 86_400_000),
    apiRateLimitMax: toNumber(process.env.API_RATE_LIMIT_MAX, constants_1.DEFAULT_API_RATE_LIMIT_MAX, 100, 50_000),
    enableRateLimit: toBoolean(process.env.ENABLE_RATE_LIMIT, false),
    disableRateLimit: toBoolean(process.env.DISABLE_RATE_LIMIT, false),
    disableRateLimitForDev: toBoolean(process.env.DISABLE_RATE_LIMIT_FOR_DEV, true),
    csrfRequireOriginForCookie: toBoolean(process.env.CSRF_REQUIRE_ORIGIN_FOR_COOKIE, true),
    csrfEnforceFetchMetadata: toBoolean(process.env.CSRF_ENFORCE_FETCH_METADATA, true),
    db: {
        host: String(process.env.DB_HOST || "localhost"),
        port: toNumber(process.env.DB_PORT, 5432, 1, 65535),
        name: String(process.env.DB_NAME || "filspresso"),
        user: String(process.env.DB_USER || "filspresso_user"),
    },
    strictServiceDbCredentials: toBoolean(process.env.STRICT_SERVICE_DB_CREDENTIALS, false),
    health: {
        aiHealthHost: String(process.env.PYTHON_AI_HOST || process.env.NEXT_PUBLIC_AI_URL || "http://localhost:5000"),
        adminHealthUrl: String(process.env.ADMIN_HEALTH_URL || ""),
    },
    opa: {
        url: String(process.env.OPA_URL || ""),
        timeoutMs: toNumber(process.env.OPA_TIMEOUT_MS, 1_500, 250, 10_000),
        failClosed: toBoolean(process.env.OPA_FAIL_CLOSED, false),
    },
    integrations: {
        rustCryptoUrl: String(process.env.RUST_CRYPTO_URL || "http://localhost:8090"),
        invoiceServiceUrl: String(process.env.INVOICE_SERVICE_URL || "http://localhost:8082"),
        goOpsUrl: String(process.env.GO_OPS_URL || "http://localhost:8083"),
        kotlinSubscriptionsUrl: String(process.env.KOTLIN_SUBSCRIPTIONS_URL || "http://localhost:8084"),
    },
});
