export type AccountSession = {
	full_name?: string | null;
	username?: string | null;
	email?: string | null;
	icon?: string | null;
	role?: string | null;
	token?: string | null;
	subscription?: string | null;
};

const ACCOUNT_SESSION_KEY = "account_session";

function parseSession(value: string | null): AccountSession | null {
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
	const localRaw = localStorage.getItem(ACCOUNT_SESSION_KEY);
	const sessionRaw = sessionStorage.getItem(ACCOUNT_SESSION_KEY);

	const localData = parseSession(localRaw);
	const sessionData = parseSession(sessionRaw);
	const resolved = localData || sessionData;
	if (!resolved) return null;

	const normalized = JSON.stringify(resolved);
	if (localRaw !== normalized) {
		localStorage.setItem(ACCOUNT_SESSION_KEY, normalized);
	}
	if (sessionRaw !== normalized) {
		sessionStorage.setItem(ACCOUNT_SESSION_KEY, normalized);
	}

	return resolved;
}

export function writeAccountSession(data: AccountSession): void {
	if (typeof window === "undefined") return;
	const normalized = JSON.stringify(data);
	localStorage.setItem(ACCOUNT_SESSION_KEY, normalized);
	sessionStorage.setItem(ACCOUNT_SESSION_KEY, normalized);
	window.dispatchEvent(new Event("session-update"));
}

export function clearAccountSession(): void {
	if (typeof window === "undefined") return;
	localStorage.removeItem(ACCOUNT_SESSION_KEY);
	sessionStorage.removeItem(ACCOUNT_SESSION_KEY);
	window.dispatchEvent(new Event("session-update"));
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
