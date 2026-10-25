"use strict";
/**
 * Outbound HTTP with a deadline.
 *
 * Every call to a service we do not control needs one. Without a timeout, a peer that
 * accepts the connection and then stops responding holds the request open until the
 * client's own timeouts fire much later -- and if the caller was holding a pooled
 * database connection, it holds that too. That is how a slow third party turns into an
 * exhausted connection pool.
 *
 * `body` is bounded separately by `maxBytes` where the response is buffered.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpstreamTooLargeError = exports.UpstreamTimeoutError = void 0;
exports.readIntEnv = readIntEnv;
exports.fetchBounded = fetchBounded;
class UpstreamTimeoutError extends Error {
    url;
    timeoutMs;
    constructor(url, timeoutMs) {
        super(`upstream timed out after ${timeoutMs}ms: ${url}`);
        this.url = url;
        this.timeoutMs = timeoutMs;
        this.name = "UpstreamTimeoutError";
    }
}
exports.UpstreamTimeoutError = UpstreamTimeoutError;
class UpstreamTooLargeError extends Error {
    url;
    maxBytes;
    constructor(url, maxBytes) {
        super(`upstream response exceeded ${maxBytes} bytes: ${url}`);
        this.url = url;
        this.maxBytes = maxBytes;
        this.name = "UpstreamTooLargeError";
    }
}
exports.UpstreamTooLargeError = UpstreamTooLargeError;
/** Read a fixed budget from an int env var, clamped. */
function readIntEnv(name, fallback, min, max) {
    const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}
/**
 * fetch, bounded in time and (optionally) in size.
 *
 * The size cap is enforced from `Content-Length` when the server sends it, and again
 * while streaming, because a chunked response has no declared length and would
 * otherwise be buffered without limit.
 */
async function fetchBounded(url, options = {}) {
    const timeoutMs = options.timeoutMs ?? readIntEnv("UPSTREAM_TIMEOUT_MS", 8000, 500, 60000);
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted)
        controller.abort();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: options.method,
            headers: options.headers,
            body: options.body,
            signal: controller.signal,
            ...(options.redirect ? { redirect: options.redirect } : {}),
        });
        if (options.maxBytes !== undefined) {
            // Read the declared length once. When it is present and within budget the body can
            // be handed back untouched; when it is missing (chunked) the cap can only be
            // enforced while streaming.
            const rawLength = response.headers.get("content-length");
            const declared = rawLength === null ? NaN : Number(rawLength);
            if (Number.isFinite(declared)) {
                if (declared > options.maxBytes) {
                    void response.body?.cancel().catch(() => undefined);
                    throw new UpstreamTooLargeError(url, options.maxBytes);
                }
            }
            return await rebufferWithCap(response, url, options.maxBytes, controller.signal);
        }
        return response;
    }
    catch (e) {
        if (e instanceof UpstreamTooLargeError)
            throw e;
        if (e?.name === "AbortError") {
            throw new UpstreamTimeoutError(url, timeoutMs);
        }
        throw e;
    }
    finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
    }
}
/** Copy a response body, failing once the byte budget is exceeded. */
async function rebufferWithCap(response, url, maxBytes, signal) {
    const body = response.body;
    if (!body)
        return response;
    const reader = body.getReader();
    let abort;
    const cancelled = new Promise((_, reject) => {
        abort = () => reject(new DOMException("Upstream request aborted", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted)
            abort();
    });
    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await Promise.race([reader.read(), cancelled]);
            if (done)
                break;
            if (!value)
                continue;
            total += value.byteLength;
            if (total > maxBytes) {
                throw new UpstreamTooLargeError(url, maxBytes);
            }
            chunks.push(value);
        }
    }
    finally {
        signal.removeEventListener("abort", abort);
        void reader.cancel().catch(() => undefined);
        try {
            reader.releaseLock();
        }
        catch { /* A cancelled read may still be settling. */ }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new Response(merged, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}
