import { NextResponse } from "next/server";
import { API_BASE, clearAdminSessionCookie, getAdminSessionTokenFromCookie, setAdminSessionCookie } from "../shared";

const RESERVED_SEGMENTS = new Set(["login", "logout", "session", "mfa"]);

type RouteContext = {
	params: Promise<{ path: string[] }>;
};

async function forwardAdminRequest(request: Request, context: RouteContext, method: string) {
	const { path } = await context.params;
	if (!Array.isArray(path) || path.length === 0) {
		return NextResponse.json({ error: "Admin route not found" }, { status: 404 });
	}

	if (RESERVED_SEGMENTS.has(path[0])) {
		return NextResponse.json({ error: "Admin route not found" }, { status: 404 });
	}

	const token = await getAdminSessionTokenFromCookie();
	if (!token) {
		return NextResponse.json({ error: "Admin authentication required" }, { status: 401 });
	}

	const upstreamUrl = new URL(`${API_BASE}/api/admin/${path.join("/")}`);
	const incomingUrl = new URL(request.url);
	upstreamUrl.search = incomingUrl.search;

	const headers = new Headers();
	headers.set("Authorization", `Bearer ${token}`);
	const accept = request.headers.get("accept");
	if (accept) {
		headers.set("Accept", accept);
	}

	const contentType = request.headers.get("content-type");
	if (contentType) {
		headers.set("Content-Type", contentType);
	}

	const cookie = request.headers.get("cookie");
	if (cookie) {
		headers.set("Cookie", cookie);
	}

	const body = method === "GET" || method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());
	const backendResponse = await fetch(upstreamUrl, {
		method,
		headers,
		body,
		cache: "no-store",
	});

	if (backendResponse.status === 401) {
		await clearAdminSessionCookie();
	} else if (backendResponse.ok) {
		await setAdminSessionCookie(token, 300);
	}

	const responseHeaders = new Headers();
	const upstreamContentType = backendResponse.headers.get("content-type");
	if (upstreamContentType) {
		responseHeaders.set("Content-Type", upstreamContentType);
	}

	const setCookieHeader = backendResponse.headers.get("set-cookie");
	if (setCookieHeader) {
		responseHeaders.set("Set-Cookie", setCookieHeader);
	}

	return new NextResponse(backendResponse.body, {
		status: backendResponse.status,
		headers: responseHeaders,
	});
}

export async function GET(request: Request, context: RouteContext) {
	return forwardAdminRequest(request, context, "GET");
}

export async function POST(request: Request, context: RouteContext) {
	return forwardAdminRequest(request, context, "POST");
}

export async function PUT(request: Request, context: RouteContext) {
	return forwardAdminRequest(request, context, "PUT");
}

export async function DELETE(request: Request, context: RouteContext) {
	return forwardAdminRequest(request, context, "DELETE");
}

export async function PATCH(request: Request, context: RouteContext) {
	return forwardAdminRequest(request, context, "PATCH");
}
