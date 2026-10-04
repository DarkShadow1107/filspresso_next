import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Chat history, proxied to the NestJS chat module.
 *
 * This route used to read and write `src/data/chat_history.json`: one shared file
 * for every visitor, with no authentication, no size cap and no per-account
 * scoping. Anyone could read every other person's transcripts (including inline
 * base64 images) or overwrite the lot.
 *
 * It is now a thin, authenticated proxy to `/api/chat/history`, which is scoped by
 * `JwtAuthGuard` to `req.user.id` and stores rows in Postgres. The request and
 * response shapes are unchanged, so the browser needs no change here.
 */

/**
 * A signed-out caller gets 401 instead of a fallback payload.
 *
 * Deliberately no "empty history" fallback: silently returning `[]` would let the
 * client believe a signed-out visitor had no conversations, and would mask a
 * backend outage as data loss.
 */
function unauthorized() {
	return NextResponse.json(
		{ error: "AUTH_SESSION_INVALID", message: "Sign in to load your conversations." },
		{ status: 401, headers: { "Cache-Control": "no-store" } },
	);
}

export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/chat/history", {
		timeoutMs: 5000,
		fallback: () => unauthorized(),
	});
}

export async function POST(request: NextRequest) {
	// No fallback: a failed save must surface as an error rather than a silent 200.
	return proxyBackendRequest(request, "/api/chat/history", { timeoutMs: 8000 });
}