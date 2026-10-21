import { proxyBackendRequest } from "@/lib/server/backend";
import type { NextRequest } from "next/server";

/**
 * Where the desktop app is, and whether this account may have it.
 *
 * The account page asks for this so the download can be shown without the page
 * having to know where installers live. The answer is available to an account
 * without Spectre access too: the app is a Spectre feature, but hiding the fact
 * that it exists from someone who has not subscribed yet is how a product nobody
 * can find stays that way. What the answer withholds is the file itself.
 *
 * Proxied, so the session cookie travels with the request: the backend answers
 * this per account, and the browser cannot call it cross-origin with credentials.
 */
export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/desktop/installer", { timeoutMs: 8000 });
}
