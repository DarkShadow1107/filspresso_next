type CachedSnapshot<T> = {
	timestamp: number;
	value: T;
};

const memoryCache = new Map<string, CachedSnapshot<unknown>>();

function isBrowser() {
	return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function readSnapshot<T>(key: string, maxAgeMs: number): T | null {
	const now = Date.now();
	const memory = memoryCache.get(key) as CachedSnapshot<T> | undefined;
	if (memory && now - memory.timestamp <= maxAgeMs) {
		return memory.value;
	}

	if (!isBrowser()) return null;

	try {
		const raw = window.sessionStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as CachedSnapshot<T>;
		if (!parsed || typeof parsed.timestamp !== "number" || now - parsed.timestamp > maxAgeMs) {
			window.sessionStorage.removeItem(key);
			return null;
		}
		memoryCache.set(key, parsed);
		return parsed.value;
	} catch {
		return null;
	}
}

export function writeSnapshot<T>(key: string, value: T) {
	const payload: CachedSnapshot<T> = { timestamp: Date.now(), value };
	memoryCache.set(key, payload);

	if (!isBrowser()) return;

	try {
		window.sessionStorage.setItem(key, JSON.stringify(payload));
	} catch {
		// Cache is opportunistic only.
	}
}

