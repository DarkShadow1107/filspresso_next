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

export function copyRequestHeaders(request: NextRequest) {
	const headers = new Headers();
	const allowed = [
		"authorization",
		"cookie",
		"content-type",
		"x-forwarded-for",
		"x-kafelot-fingerprint",
		"x-kafelot-scope",
		"x-request-id",
	];

	for (const name of allowed) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}

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
	options: { timeoutMs?: number; fallback?: () => NextResponse; responseHeaders?: HeadersInit } = {},
) {
	const timeoutMs = options.timeoutMs ?? 5000;
	const deadline = Date.now() + timeoutMs;

	try {
		const method = request.method.toUpperCase();
		const headers = copyRequestHeaders(request);
		const body = method !== "GET" && method !== "HEAD" ? await request.arrayBuffer() : null;
		let response: Response | null = null;
		const origins = getBackendOrigins();

		for (const origin of origins) {
			const remainingMs = deadline - Date.now();
			if (remainingMs <= 250) break;

			const controller = new AbortController();
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
