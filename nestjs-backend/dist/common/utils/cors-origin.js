"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseConfiguredOrigins = parseConfiguredOrigins;
exports.allowLocalhostOrigin = allowLocalhostOrigin;
exports.isAllowedCorsOrigin = isAllowedCorsOrigin;
function parseConfiguredOrigins(rawOrigins) {
    return String(rawOrigins || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
}
function allowLocalhostOrigin(origin) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
function isAllowedCorsOrigin(origin, configuredOrigins, isProduction) {
    if (!origin)
        return true;
    if (configuredOrigins.includes(origin))
        return true;
    if (!isProduction && allowLocalhostOrigin(origin))
        return true;
    return false;
}
