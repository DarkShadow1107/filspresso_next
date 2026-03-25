import { NextResponse } from "next/server";
import { API_BASE, parseJsonSafe, setAdminSessionCookie } from "../shared";

type LoginPayload = {
	token?: string;
	expiresIn?: number;
	[key: string]: unknown;
};

export async function POST(request: Request) {
	try {
		const body = await request.text();
		const contentType = request.headers.get("content-type") || "application/json";
		const accept = request.headers.get("accept") || "application/json";

		const backendResponse = await fetch(`${API_BASE}/api/admin/login`, {
			method: "POST",
			headers: {
				"Content-Type": contentType,
				Accept: accept,
			},
			body,
			cache: "no-store",
		});

		const raw = await backendResponse.text();
		const parsed = parseJsonSafe(raw);

		if (!parsed || typeof parsed !== "object") {
			return new NextResponse(raw || "", {
				status: backendResponse.status,
				headers: {
					"Content-Type": backendResponse.headers.get("content-type") || "text/plain; charset=utf-8",
				},
			});
		}

		const data = { ...(parsed as LoginPayload) };
		const token = typeof data.token === "string" ? data.token.trim() : "";
		if (backendResponse.ok && token) {
			await setAdminSessionCookie(token, Number(data.expiresIn || 300));
			delete data.token;
		}

		return NextResponse.json(data, { status: backendResponse.status });
	} catch {
		return NextResponse.json({ error: "Admin login proxy failed" }, { status: 500 });
	}
}
