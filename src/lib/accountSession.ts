export type AccountSession = {
	full_name?: string | null;
	username?: string | null;
	email?: string | null;
	icon?: string | null;
	role?: string | null;
	subscription?: string | null;
};

const ACCOUNT_PROFILE_KEY = "account_profile";

// The session token lives in an httpOnly cookie that JavaScript cannot read, so
// this store only keeps the non-sensitive profile used to render the UI. Auth
// state is always resolved from the server via /api/auth/me.
function parseProfile(value: string | null): AccountSession | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value) as AccountSession;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

export function readAccountSession(): AccountSession | null {
	if (typeof window === "undefined") return null;
	return parseProfile(window.localStorage.getItem(ACCOUNT_PROFILE_KEY));
}

export function writeAccountSession(data: AccountSession): void {
	if (typeof window === "undefined") return;
	const { token: _token, ...profile } = data as AccountSession & { token?: string | null };
	void _token;
	window.localStorage.setItem(ACCOUNT_PROFILE_KEY, JSON.stringify(profile));
	window.dispatchEvent(new Event("session-update"));
}

export function clearAccountSession(): void {
	if (typeof window === "undefined") return;
	window.localStorage.removeItem(ACCOUNT_PROFILE_KEY);
	window.dispatchEvent(new Event("session-update"));
}

const ANONYMOUS_PROFILE_KEY = "account_anonymous";

export function isAccountAnonymous(): boolean {
	if (typeof window === "undefined") return true;
	return window.localStorage.getItem(ANONYMOUS_PROFILE_KEY) !== "1";
}

/**
 * Marks a visitor as deliberately signed out so the UI stops treating them as
 * "maybe logged in" after an explicit logout.
 */
export function markAccountAnonymous(): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(ANONYMOUS_PROFILE_KEY, "1");
	window.dispatchEvent(new Event("session-update"));
}

export function clearAccountAnonymous(): void {
	if (typeof window === "undefined") return;
	window.localStorage.removeItem(ANONYMOUS_PROFILE_KEY);
}

export function createDefaultAvatarDataUrl(seedValue: string): string {
	const seed = (seedValue || "User").trim() || "User";
	const initials =
		seed
			.replace(/[^a-zA-Z\s]/g, " ")
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() || "")
			.join("") || "U";

	let hash = 0;
	for (let i = 0; i < seed.length; i += 1) {
		hash = (hash << 5) - hash + seed.charCodeAt(i);
		hash |= 0;
	}
	const hue = Math.abs(hash) % 360;
	const hue2 = (hue + 35) % 360;

	const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
		<defs>
			<linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
				<stop offset='0%' stop-color='hsl(${hue}, 70%, 52%)'/>
				<stop offset='100%' stop-color='hsl(${hue2}, 75%, 42%)'/>
			</linearGradient>
		</defs>
		<rect width='64' height='64' rx='14' fill='url(#g)'/>
		<text x='50%' y='52%' text-anchor='middle' dominant-baseline='middle' fill='white' font-size='24' font-family='Segoe UI, Arial, sans-serif' font-weight='700'>${initials}</text>
	</svg>`;

	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
