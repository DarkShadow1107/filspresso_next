import { proxyBackendRequest } from "@/lib/server/backend";
import type { NextRequest } from "next/server";

/**
 * Add funds to the card wallet.
 *
 * Server-side relayed, so the browser never talks to the billing service directly and the
 * session cookie stays same-origin. The backend refuses this without a default card rather
 * than minting money with nothing to charge, and that refusal is passed through intact --
 * the account page shows the real reason instead of a generic failure.
 */
export async function POST(request: NextRequest) {
	return proxyBackendRequest(request, "/api/billing/fund", { timeoutMs: 10000 });
}