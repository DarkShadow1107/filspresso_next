import { NextResponse } from "next/server";
import { API_BASE, clearAdminSessionCookie, getAdminSessionTokenFromCookie, setAdminSessionCookie } from "../shared";

export async function GET() {
	try {
		const token = await getAdminSessionTokenFromCookie();
		if (!token) {
			return NextResponse.json({ error: "Admin authentication required" }, { status: 401 });
		}

		const backendResponse = await fetch(`${API_BASE}/api/admin/session`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			},
			cache: "no-store",
		});

		if (backendResponse.status === 401) {
			await clearAdminSessionCookie();
		}

		const contentType = backendResponse.headers.get("content-type") || "application/json";
		const raw = await backendResponse.text();

		if (backendResponse.ok) {
			await setAdminSessionCookie(token, 300);
		}

		return new NextResponse(raw, {
			status: backendResponse.status,
			headers: {
				"Content-Type": contentType,
			},
		});
	} catch {
		return NextResponse.json({ error: "Admin session validation failed" }, { status: 500 });
	}
}
