import { fetchCurrentAccount } from "./clientAuth";
import { clearAccountSession } from "./accountSession";

/**
 * Cached "is there a live session?" flag.
 *
 * The session cookie is httpOnly, so the browser cannot answer this question
 * synchronously. This module keeps the last server answer in memory so existing
 * control flow can stay synchronous, and re-primes it from `/api/auth/me`
 * whenever the session may have changed.
 */

let signedIn = false;
let primed = false;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

export function isSignedIn(): boolean {
	return signedIn;
}

export function subscribeAuthState(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function setSignedIn(value: boolean): void {
	const changed = signedIn !== value;
	signedIn = value;
	primed = true;
	if (changed) emit();
}

export function isAuthStatePrimed(): boolean {
	return primed;
}

/** Asks the server whether a session exists and caches the answer. */
export function primeAuthState(force = false): Promise<boolean> {
	if (inflight) return inflight;
	if (primed && !force) return Promise.resolve(signedIn);

	inflight = fetchCurrentAccount()
		.then((account) => {
			const active = Boolean(account);
			const changed = signedIn !== active;
			signedIn = active;
			primed = true;
			if (changed) emit();
			return active;
		})
		.catch(() => {
			primed = true;
			return signedIn;
		})
		.finally(() => {
			inflight = null;
		});

	return inflight;
}

/** Called when the server reports the session is gone (401), to stop retrying. */
export function invalidateAuthState(): void {
	signedIn = false;
	primed = true;
	clearAccountSession();
	emit();
}
