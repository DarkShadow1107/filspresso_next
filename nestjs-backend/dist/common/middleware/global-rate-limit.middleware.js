"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldEnableGlobalRateLimit = shouldEnableGlobalRateLimit;
exports.createGlobalRateLimiter = createGlobalRateLimiter;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const constants_1 = require("../../config/constants");
function shouldEnableGlobalRateLimit() {
    const enableRateLimit = process.env.ENABLE_RATE_LIMIT === "true";
    const isProduction = process.env.NODE_ENV === "production";
    const disableForDev = process.env.DISABLE_RATE_LIMIT_FOR_DEV === "true";
    const disableRateLimit = process.env.DISABLE_RATE_LIMIT === "true";
    return enableRateLimit || (isProduction && !disableForDev && !disableRateLimit);
}
function createGlobalRateLimiter() {
    const windowMs = Math.max(60_000, Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || String(constants_1.DEFAULT_API_RATE_LIMIT_WINDOW_MS), 10));
    const max = Math.max(100, Number.parseInt(process.env.API_RATE_LIMIT_MAX || String(constants_1.DEFAULT_API_RATE_LIMIT_MAX), 10));
    const options = {
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many requests, please try again later." },
        skip: (req) => constants_1.GLOBAL_RATE_LIMIT_EXCLUDED_PATHS.has(req.path),
    };
    return (0, express_rate_limit_1.default)(options);
}
