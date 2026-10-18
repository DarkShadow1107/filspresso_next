import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import * as crypto from "crypto";

/**
 * The global throttle, with one deliberate exception: the desktop auth routes are keyed by
 * account and device rather than by IP.
 *
 * Why this needs to exist rather than a bigger limit. `ThrottlerGuard` keys on IP, and for
 * `POST /api/auth/login` that is right -- a burst of logins from one address is the shape of
 * credential stuffing. It is wrong for a desktop client in two ways at once:
 *
 *   - False positives. A company behind one NAT, a university, or a mobile carrier puts
 *     every user behind a single address. Their logins share one budget of 10 per 15
 *     minutes, so one person's repeated typo exhausts it and locks out everyone else on
 *     that network. The symptom is a support ticket that reads "the app randomly signs me
 *     out", and it is not reproducible on the developer's machine.
 *   - A blind spot. Keying on IP alone means an attacker who rotates source addresses gets
 *     an unlimited budget against a single account, because the budget was never about the
 *     account in the first place.
 *
 * Keying on account + device fixes both: the budget belongs to the thing being protected,
 * and a shared address stops being a shared allowance. A per-IP ceiling is not dropped --
 * `super.getTracker` still governs every other route, and the escalating per-account
 * lockout in AuthComplexService is a second, independent layer behind this one.
 *
 * Only the two `/api/auth/desktop/` routes are treated this way. Everything else keeps the
 * stock tracker, because changing the key for the web login would weaken the one endpoint
 * where a generous limit is a real vulnerability.
 */
@Injectable()
export class DesktopAwareThrottlerGuard extends ThrottlerGuard {
	/** Routes that get the account+device key. Anything else is stock. */
	private static readonly DESKTOP_ROUTE_PREFIX = "/api/auth/desktop/";

	protected override async getTracker(req: Record<string, any>): Promise<string> {
		const request = req as unknown as Request;
		if (!String(request?.originalUrl || request?.url || "").startsWith(DesktopAwareThrottlerGuard.DESKTOP_ROUTE_PREFIX)) {
			return super.getTracker(req);
		}
		return DesktopAwareThrottlerGuard.desktopKey(request);
	}

	/**
	 * `sha256(account|device)` — hashed, because this string is a Redis key and a rate limit
	 * store is not the place an email address should be lying around in plaintext.
	 *
	 * Falls back to the peer address when there is no account field to key on, which is the
	 * only case where a desktop request is limited by IP: a malformed or empty body. That
	 * is exactly the traffic worth limiting by address, so the fallback is aligned with the
	 * intent rather than merely being safe.
	 */
	private static desktopKey(request: Request): string {
		const body = (request?.body ?? {}) as Record<string, unknown>;
		const loginField = String(body.email || body.username || "").trim().toLowerCase().slice(0, 254);
		const deviceId = String(body.deviceId || "").trim().slice(0, 64);
		const ip = String(request?.ip || request?.socket?.remoteAddress || "unknown");

		const parts = [loginField, deviceId || "no-device", ip];
		const raw = parts.filter(Boolean).join("|");
		if (!loginField) {
			// No account to protect yet: address only, which is what the stock guard does.
			return `desktop:${ip}`;
		}
		return `desktop:${crypto.createHash("sha256").update(raw).digest("hex")}`;
	}
}
