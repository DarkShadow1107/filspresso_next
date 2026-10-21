import { NextRequest, NextResponse } from "next/server";

import { buildForwardedCookieHeader, copyRequestHeaders, getBackendOrigins } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The desktop client's installer.
 *
 * Proxied rather than linked straight to the backend so the download carries the
 * browser's session cookie: the backend gates the file on Spectre access, and a
 * link that dropped the cookie would be refused for an account that has it.
 *
 * The body is passed through byte for byte and streamed, not buffered: an MSI is a
 * binary over 50 MB, so it is never parsed, never re-encoded and never held in
 * memory in full.
 */
export async function GET(request: NextRequest) {
	const headers = copyRequestHeaders(request);
	const cookie = buildForwardedCookieHeader(request.headers.get("cookie"));
	if (cookie) headers.set("cookie", cookie);

	let lastStatus = 503;
	let lastBody = JSON.stringify({
		error: "DOWNLOAD_UNAVAILABLE",
		message: "The desktop app could not be fetched right now.",
	});

	for (const origin of getBackendOrigins()) {
		try {
			const upstream = await fetch(`${origin}/api/desktop/download`, {
				method: "GET",
				headers,
				cache: "no-store",
				redirect: "manual",
			});

			// A refusal comes back as JSON with a status, and it is passed through as it
			// is: the account page needs to say *why* the download is not available.
			if (!upstream.ok) {
				lastStatus = upstream.status;
				lastBody = await upstream.text();
				continue;
			}

			const responseHeaders = new Headers();
			for (const name of ["content-type", "content-length", "content-disposition"]) {
				const value = upstream.headers.get(name);
				if (value) responseHeaders.set(name, value);
			}
			responseHeaders.set("Cache-Control", "no-store");
			responseHeaders.set("X-Content-Type-Options", "nosniff");

			return new NextResponse(upstream.body, { status: 200, headers: responseHeaders });
		} catch {
			// Try the next origin.
		}
	}

	return new NextResponse(lastBody || JSON.stringify({ error: "DOWNLOAD_FAILED" }), {
		status: lastStatus,
		headers: { "Content-Type": "application/json" },
	});
}
