import { readFileSync } from "node:fs";

/**
 * Build a Redis URL from `REDIS_URL` plus an optional credential.
 *
 * The password is read from `REDIS_PASSWORD_FILE` first (a Docker secret, which is
 * how the hardened compose overlay supplies it) and then `REDIS_PASSWORD`. This
 * matches the convention `go_ops` already uses, so the credential never has to be
 * interpolated into a compose file or an environment dump.
 *
 * Shared by the session cache and the rate-limit counter store so both
 * authenticate the same way. That matters: if only one of them picked up the
 * secret, the other would fail every AUTH against a `requirepass` Redis and the
 * failure mode would look like "rate limiting silently does nothing".
 */
export function resolveRedisUrl(): string {
	const base = String(process.env.REDIS_URL || "").trim();
	if (!base) return "";

	let password = "";
	const passwordFile = String(process.env.REDIS_PASSWORD_FILE || "").trim();
	if (passwordFile) {
		try {
			password = readFileSync(passwordFile, "utf8").trim();
		} catch {
			password = "";
		}
	}
	if (!password) password = String(process.env.REDIS_PASSWORD || "").trim();
	if (!base || !password) return base;

	// Inject credentials into whatever host:port form REDIS_URL uses.
	try {
		const url = new URL(base.includes("://") ? base : `redis://${base}`);
		url.password = password;
		return url.toString();
	} catch {
		return base;
	}
}