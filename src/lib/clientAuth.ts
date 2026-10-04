import { clearAccountSession, markAccountAnonymous, writeAccountSession, type AccountSession } from "./accountSession";

type MeResponse = {
	user?: {
		id?: number | string;
		username?: string | null;
		email?: string | null;
		name?: string | null;
		full_name?: string | null;
		icon?: string | null;
		role?: string | null;
		subscription?: string | null;
		subscription_name?: string | null;
	} | null;
};

function normalizeMeUser(data: MeResponse | null): AccountSession | null {
	const user = data?.user;
	if (!user) return null;

	return {
		full_name: user.full_name ?? user.name ?? null,
		username: user.username ?? null,
		email: user.email ?? null,
		icon: user.icon ?? null,
		role: user.role ?? null,
		subscription: user.subscription ?? user.subscription_name ?? null,
	};
}

/**
 * Resolves the signed-in user from the server.
 *
 * The session cookie is httpOnly, so this is the only way the UI can learn
 * whether a session exists. A static fallback is treated as signed out.
 */
export async function fetchCurrentAccount(signal?: AbortSignal): Promise<AccountSession | null> {
	try {
		const res = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin", signal });
		if (!res.ok) return null;
		const data = (await res.json()) as MeResponse;
		if ((data as { source?: string })?.source === "static-fallback") return null;
		return normalizeMeUser(data);
	} catch {
		return null;
	}
}

export async function refreshCurrentAccount(): Promise<AccountSession | null> {
	try {
		const res = await fetch("/api/auth/refresh", {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
		if (!res.ok) return null;
		return fetchCurrentAccount();
	} catch {
		return null;
	}
}

/**
 * Ends the session on the server (deleting the session row) as well as locally.
 * A purely client-side sign-out leaves a valid cookie behind.
 */
export async function logoutCurrentAccount(): Promise<void> {
	try {
		await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
	} catch {
		// Best effort: the local session is cleared regardless.
	}
	clearAccountSession();
	markAccountAnonymous();
}

export function persistAccountProfile(account: AccountSession): void {
	writeAccountSession(account);
}
