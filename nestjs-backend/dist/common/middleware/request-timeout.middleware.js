"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRequestTimeoutMiddleware = createRequestTimeoutMiddleware;
function createRequestTimeoutMiddleware(timeoutMs) {
    return (req, res, next) => {
        const request = req;
        // Source analysis and native model loads share the clients' bounded 16-minute
        // budget. The ordinary API deadline would cut off legitimate media work.
        const longRunning = ["/api/playground/context/file", "/api/playground/context/github", "/api/desktop/chat/stream", "/api/playground/chat/stream"].includes(req.path);
        const execution = /^\/api\/playground\/sandbox\/[0-9a-f-]+\/run$/.test(req.path);
        const agent = ["/api/playground/agent/turn", "/api/desktop/agent/turn"].includes(req.path);
        const timeout = setTimeout(() => {
            if (res.headersSent)
                return;
            res.status(503).json({
                error: "Request timed out",
                requestId: request.requestId,
            });
        }, longRunning ? 16 * 60_000 : execution ? 75_000 : agent ? 130_000 : timeoutMs);
        const clear = () => clearTimeout(timeout);
        res.on("finish", clear);
        res.on("close", clear);
        next();
    };
}
