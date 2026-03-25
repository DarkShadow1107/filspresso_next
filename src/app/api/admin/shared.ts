import { cookies } from "next/headers";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
export const ADMIN_COOKIE_NAME = "admin_token";
const DEFAULT_ADMIN_SESSION_SECONDS = 5 * 60;

export function parseJsonSafe(input: string): unknown {
	if (!input) return null;
	try {
		return JSON.parse(input);
	} catch {
		return null;
	}
}

export async function setAdminSessionCookie(token: string, expiresInSeconds?: number) {
	const cookieStore = await cookies();
	const maxAge = Number.isFinite(expiresInSeconds)
		? Math.max(60, Math.floor(Number(expiresInSeconds)))
		: DEFAULT_ADMIN_SESSION_SECONDS;

	cookieStore.set(ADMIN_COOKIE_NAME, token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge,
	});
}

export async function clearAdminSessionCookie() {
	const cookieStore = await cookies();
	cookieStore.set(ADMIN_COOKIE_NAME, "", {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 0,
	});
}

export async function getAdminSessionTokenFromCookie() {
	const cookieStore = await cookies();
	return cookieStore.get(ADMIN_COOKIE_NAME)?.value?.trim() || "";
}
