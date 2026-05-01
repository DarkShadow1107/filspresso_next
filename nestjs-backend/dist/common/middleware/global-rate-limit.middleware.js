"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldEnableGlobalRateLimit = shouldEnableGlobalRateLimit;
exports.createGlobalRateLimiter = createGlobalRateLimiter;
function shouldEnableGlobalRateLimit() {
    return false;
}
function createGlobalRateLimiter() {
    return (req, res, next) => next();
}
