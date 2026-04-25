"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestIdMiddleware = requestIdMiddleware;
const node_crypto_1 = require("node:crypto");
function resolveRequestId(req) {
    const headerValue = String(req.headers["x-request-id"] || "").trim();
    const safeHeader = headerValue.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    return safeHeader || (0, node_crypto_1.randomUUID)();
}
function requestIdMiddleware(req, res, next) {
    req.requestId = resolveRequestId(req);
    res.setHeader("x-request-id", req.requestId);
    next();
}
