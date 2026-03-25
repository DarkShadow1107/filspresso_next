import { NextResponse } from "next/server";
import { API_BASE, clearAdminSessionCookie, getAdminSessionTokenFromCookie } from "../shared";

export async function POST() {
	const token = await getAdminSessionTokenFromCookie();
	try {
		if (token) {
			await fetch(`${API_BASE}/api/admin/logout`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
				},
				cache: "no-store",
			});
		}
	} catch {
		// Best-effort server logout; client cookie is still cleared.
	}

	await clearAdminSessionCookie();
	return NextResponse.json({ status: "success", message: "Admin logged out" });
}
