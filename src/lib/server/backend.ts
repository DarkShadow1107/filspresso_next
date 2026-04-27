import { NextRequest, NextResponse } from "next/server";

const DEFAULT_BACKEND_ORIGIN = "http://localhost:4000";

export const BACKEND_API_BASE = process.env.NEXT_PUBLIC_API_URL || DEFAULT_BACKEND_ORIGIN;

type FetchJsonOptions = {
	headers?: HeadersInit;
	timeoutMs?: number;
	cache?: RequestCache;
};

export function buildBackendUrl(pathname: string, search = "") {
	const base = BACKEND_API_BASE.replace(/\/+$/, "");
	const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${base}${path}${search}`;
}

export function copyRequestHeaders(request: NextRequest) {
	const headers = new Headers();
	const allowed = [
		"authorization",
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

export async function proxyBackendRequest(
	request: NextRequest,
	backendPathname: string,
	options: { timeoutMs?: number; fallback?: () => NextResponse; responseHeaders?: HeadersInit } = {},
) {
	const timeoutMs = options.timeoutMs ?? 5000;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const method = request.method.toUpperCase();
		const headers = copyRequestHeaders(request);
		const init: RequestInit = {
			method,
			headers,
			cache: "no-store",
			signal: controller.signal,
		};

		if (method !== "GET" && method !== "HEAD") {
			const body = await request.arrayBuffer();
			if (body.byteLength > 0) {
				init.body = body;
			}
		}

		const response = await fetch(buildBackendUrl(backendPathname, request.nextUrl.search), init);
		const responseHeaders = new Headers(options.responseHeaders);
		const contentType = response.headers.get("content-type");
		if (contentType) responseHeaders.set("content-type", contentType);
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
	} finally {
		clearTimeout(timeout);
	}
}
