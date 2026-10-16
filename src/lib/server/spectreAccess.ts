import { cookies } from "next/headers";
import { buildBackendUrl, buildForwardedCookieHeader } from "@/lib/server/backend";
import { normalizeModelTier, type UserSubscriptionTier } from "@/lib/modelAccess";

/**
 * Whether this account may use the Spectre Playground, and why.
 *
 * ## Why this exists rather than more tier comparisons
 *
 * The Playground was gated by `tierCanUsePlayground(tier)` in four separate places -- the
 * chat route, prewarm, the wallet funding endpoint and the model line-up. Each was a
 * chance for the gate and the UI to disagree, and they did: the gate answered for Max and
 * Ultimate while the line-up showed "from Max" to everyone else.
 *
 * The Spectre subscription (99.99 RON/month, sold alongside the tiers) makes that worse
 * rather than better: access now comes from a subscription the tier ladder knows nothing
 * about. So the answer is fetched once, from the same service that enforces it, and
 * carries the *reason* as well as the boolean -- the UI needs to say why, not merely
 * whether.
 *
 * Fails closed. A billing service that cannot be reached must not read as "yes", or the
 * gate disappears exactly when something is already wrong.
 */
export type SpectreAccess = {
	hasAccess: boolean;
	/** 'addon' when bought separately, 'tier' when bundled with Max/Ultimate. */
	source: "addon" | "tier" | null;
	expiresAt: string | null;
	autoRenew: boolean;
	canFundWallet: boolean;
};

const NO_ACCESS: SpectreAccess = {
	hasAccess: false,
	source: null,
	expiresAt: null,
	autoRenew: false,
	canFundWallet: false,
};

export async function resolveSpectreAccess(request: Request): Promise<SpectreAccess> {
	const cookie = buildForwardedCookieHeader(request.headers.get("cookie"));
	// An anonymous visitor has no session, so there is nothing to ask about. They do not
	// have access -- but the caller treats this as "not signed in" rather than "denied",
	// because the right next step is a sign-in prompt, not a paywall.
	if (!cookie) return NO_ACCESS;
	void cookies();

	try {
		const res = await fetch(buildBackendUrl("/api/spectre/access"), {
			headers: { cookie, accept: "application/json" },
			cache: "no-store",
		});
		if (!res.ok) return NO_ACCESS;
		const body = (await res.json()) as Partial<SpectreAccess>;
		return {
			hasAccess: body.hasAccess === true,
			source: body.source ?? null,
			expiresAt: body.expiresAt ?? null,
			autoRenew: body.autoRenew === true,
			canFundWallet: body.canFundWallet === true,
		};
	} catch {
		return NO_ACCESS;
	}
}

/** Convenience for callers that only need the boolean, and must not fail open. */
export async function hasSpectreAccess(request: Request): Promise<boolean> {
	return (await resolveSpectreAccess(request)).hasAccess;
}

/**
 * Fallback for render paths that have no Request -- the model line-up, which is a pure
 * presentational component rendered inside the client bundle.
 *
 * It deliberately answers from the *tier alone*, so it can only ever be a conservative
 * under-claim: an add-on holder on a low tier will be shown as locked until the
 * authoritative answer arrives. Over-claiming is the failure that matters, and this cannot
 * do it.
 */
export function tierImpliesSpectreAccess(tier: UserSubscriptionTier | string | null | undefined): boolean {
	const value = normalizeModelTier(String(tier ?? "none"));
	return value === "max" || value === "ultimate";
}