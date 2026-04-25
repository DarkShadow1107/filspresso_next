"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRequestTimeoutMiddleware = createRequestTimeoutMiddleware;
function createRequestTimeoutMiddleware(timeoutMs) {
    return (req, res, next) => {
        const request = req;
        const timeout = setTimeout(() => {
            if (res.headersSent)
                return;
            res.status(503).json({
                error: "Request timed out",
                requestId: request.requestId,
            });
        }, timeoutMs);
        const clear = () => clearTimeout(timeout);
        res.on("finish", clear);
        res.on("close", clear);
        next();
    };
}
