/**
 * The anonymous visitor's identifier.
 *
 * One place, because two components minted this independently and disagreed: the coffee
 * helper emitted `crypto.randomUUID()` with an `fp-<timestamp>-<random>` fallback, and the
 * playground emitted 32 hex characters with no dashes at all. The backend now validates this
 * strictly as a version 4 UUID and rejects anything else with a 400, so both had to be
 * fixed and neither could keep its own shape.
 *
 * ## Existing visitors
 *
 * `kafelot_fp` is already in localStorage for anyone who has used the site, holding one of
 * those two older formats. A stored value that is not a valid UUID is *replaced*, not
 * returned -- otherwise every existing anonymous visitor would start sending a value the
 * backend refuses, and their only symptom would be a 400 on a chat they used to be able
 * to send. Losing an anonymous budget is free; losing the ability to chat is not.
 */

const STORAGE_KEY = "kafelot_fp";

/** Same rule as the server: 8-4-4-4-12 lowercase hex, version 4, RFC 4122 variant. */
const UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isValidFingerprint(value: unknown): value is string {
	return typeof value === "string" && UUID_V4.test(value);
}

/**
 * A version 4 UUID.
 *
 * `crypto.randomUUID` is unavailable on insecure origins other than localhost, so the
 * fallback builds one from `getRandomValues` and *sets the version and variant bits* --
 * the same RFC 4122 §4.4 construction. A random 36-character hex string would not be a v4
 * UUID and the server would reject it, so the bits are not optional decoration here.
 */
export function newFingerprint(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The visitor's fingerprint, minting and storing one if needed. Empty on the server. */
export function getOrCreateFingerprint(): string {
	if (typeof window === "undefined") return "";
	let existing: string | null = null;
	try {
		existing = window.localStorage.getItem(STORAGE_KEY);
	} catch {
		// Private browsing or blocked storage. A per-page fingerprint is worse than a shared
		// one, but still better than failing the request, so fall through to minting one.
	}
	if (isValidFingerprint(existing)) return existing;

	const minted = newFingerprint();
	try {
		window.localStorage.setItem(STORAGE_KEY, minted);
	} catch {
		// Storage unavailable: keep the value for this page render only.
	}
	return minted;
}
