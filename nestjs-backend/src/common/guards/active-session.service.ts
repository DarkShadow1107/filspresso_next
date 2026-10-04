import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { readSessionToken } from "../utils/session-cookie";
import { verifyToken, type JwtClaims } from "../utils/auth-tokens";
import { SessionStoreService } from "./session-store.service";

export type ResolvedSession = {
	token: string;
	claims: JwtClaims;
	accountId: number;
};

/**
 * Resolves the caller to a live, non-revoked session.
 *
 * A JWT alone only proves the signature was valid at issue time, which leaves a
 * stolen token usable until it expires. Every authenticated request therefore
 * also confirms the session is still live, so logout and per-session revocation
 * take effect immediately.
 *
 * That liveness check used to be a `SELECT ... FROM user_sessions` on every
 * request. It now goes through `SessionStoreService` (Phase 3), which answers
 * from Redis and falls back to Postgres on a miss -- so revocation stays instant
 * while the hot path stops touching the database.
 */
@Injectable()
export class ActiveSessionService {
	constructor(private readonly sessions: SessionStoreService) {}

	async resolve(req: Request): Promise<ResolvedSession | null> {
		const token = readSessionToken(req);
		if (!token) return null;

		const claims = verifyToken(token);
		if (!claims || !Number.isInteger(claims.id)) return null;

		const { session } = await this.sessions.findLiveSession(token);
		if (!session) return null;

		// The cached entry must belong to the account the JWT names. Redis is not an
		// authority here, so a mismatch is treated as no session rather than trusted.
		if (Number(session.accountId) !== Number(claims.id)) return null;

		return { token, claims, accountId: Number(claims.id) };
	}
}
