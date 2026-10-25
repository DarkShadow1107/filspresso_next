import { NextRequest, NextResponse } from "next/server";

const DEFAULT_BACKEND_ORIGIN = "http://localhost:4000";
const CONTAINER_BACKEND_ORIGINS = ["http://nestjs-backend:4000", "http://backend:4000"];

function normalizeOrigin(origin: string) {
	return origin.replace(/\/+$/, "");
}

function uniqueOrigins(origins: string[]) {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const origin of origins) {
		const normalized = normalizeOrigin(origin.trim());
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function resolveBackendOrigins() {
	return uniqueOrigins(
		[
			process.env.BACKEND_API_URL || "",
			process.env.INTERNAL_BACKEND_API_URL || "",
			process.env.NESTJS_BACKEND_URL || "",
			process.env.NEXT_PUBLIC_API_URL || "",
			DEFAULT_BACKEND_ORIGIN,
			...CONTAINER_BACKEND_ORIGINS,
		].filter(Boolean),
	);
}

const backendOrigins = resolveBackendOrigins();
let activeBackendOrigin = backendOrigins[0] || DEFAULT_BACKEND_ORIGIN;

export const BACKEND_API_BASE = activeBackendOrigin;

export function getBackendOrigins() {
	return uniqueOrigins([activeBackendOrigin, ...backendOrigins]);
}

type FetchJsonOptions = {
	headers?: HeadersInit;
	timeoutMs?: number;
	cache?: RequestCache;
};

export function buildBackendUrl(pathname: string, search = "") {
	const base = activeBackendOrigin;
	const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${base}${path}${search}`;
}

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "filspresso_session";

// Headers the backend needs in order to authenticate the caller and to run its
// CSRF origin guard. `origin`/`referer`/`sec-fetch-site` must be relayed or the
// guard rejects every cookie-authenticated state change as origin-less.
const FORWARDED_REQUEST_HEADERS = [
	"authorization",
	"content-type",
	"x-forwarded-for",
	"x-forwarded-proto",
	"x-forwarded-host",
	"x-kafelot-fingerprint",
	"x-kafelot-scope",
	"x-request-id",
	"origin",
	"referer",
	"sec-fetch-site",
	"sec-fetch-mode",
	"user-agent",
];

/**
 * Forwards only the session cookie.
 *
 * The browser also holds the admin cookie, but that one is never meant to reach
 * the API: the Next admin route reads it server-side and re-issues it as a
 * Bearer header. Relaying every cookie would leak that credential upstream.
 */
export function buildForwardedCookieHeader(cookieHeader: string | null): string {
	if (!cookieHeader) return "";

	const forwarded: string[] = [];
	for (const part of cookieHeader.split(";")) {
		const separator = part.indexOf("=");
		if (separator <= 0) continue;
		if (part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
		forwarded.push(part.trim());
	}

	return forwarded.join("; ");
}

export function copyRequestHeaders(request: Request) {
	const headers = new Headers();

	for (const name of FORWARDED_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}

	const cookie = buildForwardedCookieHeader(request.headers.get("cookie"));
	if (cookie) headers.set("cookie", cookie);

	return headers;
}

export async function fetchJsonWithTimeout<T>(url: string, options: FetchJsonOptions = {}) {
	const timeoutMs = options.timeoutMs ?? 2500;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			headers: options.headers,
			cache: options.cache ?? "no-store",
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`Backend responded with ${response.status}`);
		}

		return (await response.json()) as T;
	} finally {
		clearTimeout(timeout);
	}
}

export async function fetchBackendJsonWithTimeout<T>(pathname: string, search = "", options: FetchJsonOptions = {}) {
	const timeoutMs = options.timeoutMs ?? 2500;
	const deadline = Date.now() + timeoutMs;
	const path = pathname.startsWith("/") ? pathname : `/${pathname}`;

	for (const origin of getBackendOrigins()) {
		const remainingMs = deadline - Date.now();
		if (remainingMs <= 200) break;
		try {
			const data = await fetchJsonWithTimeout<T>(`${origin}${path}${search}`, {
				...options,
				timeoutMs: Math.max(800, remainingMs),
			});
			activeBackendOrigin = origin;
			return data;
		} catch {
			// Try next origin.
		}
	}

	throw new Error("Backend unavailable across all configured origins");
}

export async function proxyBackendRequest(
	request: NextRequest,
	backendPathname: string,
	options: { timeoutMs?: number; fallback?: () => NextResponse; responseHeaders?: HeadersInit; retry?: boolean } = {},
) {
	const timeoutMs = options.timeoutMs ?? 5000;
	const deadline = Date.now() + timeoutMs;

	try {
		const method = request.method.toUpperCase();
		const headers = copyRequestHeaders(request);
		const body = method !== "GET" && method !== "HEAD" ? await request.arrayBuffer() : null;
		let response: Response | null = null;
		const origins = options.retry === false ? getBackendOrigins().slice(0, 1) : getBackendOrigins();

		for (const origin of origins) {
			if (request.signal.aborted) break;
			const remainingMs = deadline - Date.now();
			if (remainingMs <= 250) break;

			const controller = new AbortController();
			const onAbort = () => controller.abort();
			request.signal.addEventListener("abort", onAbort, { once: true });
			const timeout = setTimeout(() => controller.abort(), Math.max(800, remainingMs));

			try {
				const path = backendPathname.startsWith("/") ? backendPathname : `/${backendPathname}`;
				const targetUrl = `${origin}${path}${request.nextUrl.search}`;
				response = await fetch(targetUrl, {
					method,
					headers,
					cache: "no-store",
					signal: controller.signal,
					body: body && body.byteLength > 0 ? body : undefined,
				});
				activeBackendOrigin = origin;
				break;
			} catch {
				// Try next origin.
			} finally {
				clearTimeout(timeout);
				request.signal.removeEventListener("abort", onAbort);
			}
		}

		if (!response) {
			throw new Error("All backend origins are unavailable");
		}

		const responseHeaders = new Headers(options.responseHeaders);
		const contentType = response.headers.get("content-type");
		if (contentType) responseHeaders.set("content-type", contentType);
		const location = response.headers.get("location");
		if (location) responseHeaders.set("location", location);
		const requestId = response.headers.get("x-request-id");
		if (requestId) responseHeaders.set("x-request-id", requestId);
		const setCookieGetter = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
		const setCookies = typeof setCookieGetter === "function" ? setCookieGetter.call(response.headers) : [];
		for (const cookie of setCookies) {
			responseHeaders.append("set-cookie", cookie);
		}
		if (!responseHeaders.has("cache-control")) {
			responseHeaders.set("Cache-Control", "no-store");
		}

		return new NextResponse(await response.arrayBuffer(), {
			status: response.status,
			headers: responseHeaders,
		});
	} catch {
		if (options.fallback) return options.fallback();
		return NextResponse.json(
			{ status: "error", error: "Backend unavailable" },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}

/** No retry/failover after a mutation: replaying an inference or tool run could bill twice. */
export async function proxyBackendStream(request: NextRequest, path: string) {
	const controller = new AbortController();
	const abort = () => controller.abort();
	request.signal.addEventListener("abort", abort, { once: true });
	const timeout = setTimeout(abort, 16 * 60_000);
	const cleanup = () => { clearTimeout(timeout); request.signal.removeEventListener("abort", abort); };
	try {
		if (request.signal.aborted) controller.abort();
		const chunks: Uint8Array[] = [];
		let size = 0;
		if (request.body) {
			const input = request.body.getReader();
			try {
				for (;;) {
					const { value, done } = await input.read();
					if (done) break;
					size += value.byteLength;
					if (size > 1024 * 1024) { await input.cancel(); cleanup(); return Response.json({ message: "Request exceeds 1 MB." }, { status: 413 }); }
					chunks.push(value);
				}
			} finally { input.releaseLock(); }
		}
		const body = Buffer.concat(chunks);
		const upstream = await fetch(buildBackendUrl(path), { method: request.method, headers: copyRequestHeaders(request), body: body.length ? body : undefined, signal: controller.signal, cache: "no-store" });
		const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": upstream.headers.get("content-type") || "application/json", "X-Accel-Buffering": "no" });
		for (const name of ["x-filspresso-request-id", "retry-after"]) { const value = upstream.headers.get(name); if (value) headers.set(name, value); }
		if (!upstream.body) { cleanup(); return new Response(null, { status: upstream.status, headers }); }
		const reader = upstream.body.getReader();
		const stream = new ReadableStream<Uint8Array>({
			async pull(output) {
				try { const { value, done } = await reader.read(); if (done) { cleanup(); output.close(); } else output.enqueue(value); }
				catch (error) { cleanup(); output.error(error); }
			},
			async cancel() { abort(); cleanup(); await reader.cancel().catch(() => undefined); },
		});
		return new Response(stream, { status: upstream.status, headers });
	} catch { cleanup(); return Response.json({ error: "BACKEND_UNAVAILABLE", message: "The backend is unavailable or the request was cancelled." }, { status: 503 }); }
}
