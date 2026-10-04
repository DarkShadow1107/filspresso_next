import { buildForwardedCookieHeader } from "@/lib/server/backend";
import { normalizeModelTier, type UserSubscriptionTier } from "@/lib/modelAccess";

/**
 * Shared Kafelot/Playground prompt metering against the Nest backend.
 *
 * Both /api/python-chat and /api/playground/chat are metered through
 * /api/kafelot/check-and-use so a playground prompt costs the same as a Kafelot
 * prompt and the two surfaces share one quota.
 */

export type PromptScope = "general" | "molecule_helper";

export type PromptLimitCheck = {
	allowed: boolean;
	errorResponse?: Response;
	prompts_remaining?: number;
	prompts_limit?: number;
	reset_date?: string;
	tier?: string;
	scope?: PromptScope;
};

export function normalizePromptScope(value: unknown): PromptScope {
	return value === "molecule_helper" ? "molecule_helper" : "general";
}

/**
 * Headers for the inner /api/kafelot call.
 *
 * The session lives in an httpOnly cookie, so the credential travels as a
 * filtered cookie header rather than an Authorization header. The backend CSRF
 * origin guard needs the browser's origin relayed or it rejects the request.
 */
export function buildPromptHeaders(request: Request, scope?: PromptScope): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };

	const cookie = buildForwardedCookieHeader(request.headers.get("cookie"));
	if (cookie) headers.cookie = cookie;

	for (const name of ["origin", "referer", "sec-fetch-site", "sec-fetch-mode"]) {
		const value = request.headers.get(name);
		if (value) headers[name] = value;
	}

	const fingerprint = request.headers.get("x-kafelot-fingerprint");
	if (fingerprint) headers["x-kafelot-fingerprint"] = fingerprint;

	const forwardedFor = request.headers.get("x-forwarded-for");
	if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;

	const resolvedScope = scope ?? normalizePromptScope(request.headers.get("x-kafelot-scope"));
	headers["x-kafelot-scope"] = resolvedScope;

	return headers;
}

type LimitPayload = {
	prompts_limit?: number;
	prompts_remaining?: number;
	reset_date?: string;
	tier?: string;
};

function limitReachedPayload(data: LimitPayload, scope: PromptScope) {
	return {
		error: "PROMPT_LIMIT_REACHED",
		message:
			data.prompts_remaining === 0
				? "You have used all of your Kafelot prompts for this period."
				: "Your Kafelot prompts are exhausted for this period.",
		prompts_remaining: data.prompts_remaining,
		prompts_limit: data.prompts_limit,
		reset_date: data.reset_date,
		// The Kafelot UI reads this to show the plan the counters belong to.
		tier: data.tier,
		prompts_scope: scope,
	};
}

/**
 * Resolves where to send the limiter self-call.
 *
 * This is a server-to-server hop, so it deliberately targets the Next server
 * directly rather than the public origin. Two reasons:
 *  - building the URL from `request.url` yields the wrong scheme behind a
 *    TLS-terminating proxy, because Next reconstructs it with its own scheme
 *  - looping out through Caddy's edge would make the server trust its own
 *    self-signed `tls internal` CA, which fails with
 *    UNABLE_TO_GET_ISSUER_CERT_LOCALLY
 *
 * Only the *transport target* is internal; the browser's original `origin` is
 * still relayed in the headers so the backend CSRF guard validates the real
 * caller.
 */
function resolveSelfCallOrigin(): string {
	const configured = process.env.INTERNAL_NEXT_ORIGIN?.trim().replace(/\/+$/, "");
	if (configured) return configured;
	return "http://localhost:3000";
}

/**
 * Consumes (or dry-runs) one prompt from the caller's quota.
 *
 * Fails closed: if the limiter cannot be reached the request is rejected rather
 * than served unmetered.
 */
export async function checkPromptLimit(
	request: Request,
	dryRun: boolean,
	scope: PromptScope,
): Promise<PromptLimitCheck> {
	let promptLimitUrl = "";
	try {
		promptLimitUrl = new URL("/api/kafelot/check-and-use", resolveSelfCallOrigin()).toString();
		const headers = buildPromptHeaders(request, scope);

		const res = await fetch(promptLimitUrl, {
			method: "POST",
			headers,
			body: JSON.stringify({ dry_run: dryRun, scope }),
		});

		if (res.status === 401 && headers.cookie) {
			return {
				allowed: false,
				errorResponse: Response.json(
					{ error: "AUTH_SESSION_INVALID", message: "Authentication session expired or invalid" },
					{ status: 401, headers: { "Cache-Control": "no-store" } },
				),
			};
		}

		if (res.status === 429) {
			const data = (await res.json()) as {
				reset_date?: string;
				prompts_limit?: number;
				prompts_remaining?: number;
				tier?: string;
				scope?: string;
			};
			return {
				allowed: false,
				prompts_remaining: data.prompts_remaining,
				prompts_limit: data.prompts_limit,
				reset_date: data.reset_date,
				tier: data.tier,
				scope: (data.scope as PromptScope) || scope,
				errorResponse: Response.json(limitReachedPayload({ ...data, tier: data.tier }, scope), {
					status: 429,
					headers: { "Cache-Control": "no-store" },
				}),
			};
		}

		if (!res.ok) {
			return {
				allowed: false,
				errorResponse: Response.json(
					{ error: "PROMPT_LIMIT_UNAVAILABLE", message: "Could not verify your prompt allowance." },
					{ status: 503, headers: { "Cache-Control": "no-store" } },
				),
			};
		}

		const data = (await res.json()) as {
			allowed?: boolean;
			prompts_remaining?: number;
			prompts_limit?: number;
			reset_date?: string;
			tier?: string;
			scope?: string;
		};

		if (data.allowed === false) {
			return {
				allowed: false,
				prompts_remaining: data.prompts_remaining,
				prompts_limit: data.prompts_limit,
				reset_date: data.reset_date,
				tier: data.tier,
				scope: (data.scope as PromptScope) || scope,
				errorResponse: Response.json(
					limitReachedPayload(
						{
							prompts_limit: data.prompts_limit,
							prompts_remaining: data.prompts_remaining,
							reset_date: data.reset_date,
							tier: data.tier,
						},
						scope,
					),
					{ status: 429, headers: { "Cache-Control": "no-store" } },
				),
			};
		}

		return {
			allowed: true,
			prompts_remaining: data.prompts_remaining,
			prompts_limit: data.prompts_limit,
			reset_date: data.reset_date,
			tier: data.tier,
			scope: (data.scope as PromptScope) || scope,
		};
	} catch {
		return {
			allowed: false,
			errorResponse: Response.json(
				{ error: "PROMPT_LIMIT_UNAVAILABLE", message: "Could not verify your prompt allowance." },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			),
		};
	}
}

/**
 * Resolves the caller's tier from their live session.
 *
 * Returns `null` when there is no authenticated session (or the backend could
 * not be reached) so callers can fail closed with 401. A valid session whose
 * subscription is missing or unrecognized resolves to the `none` tier, which
 * carries free-plan access rather than no access.
 */
export async function readCallerTier(request: Request): Promise<UserSubscriptionTier | null> {
	const cookie = buildForwardedCookieHeader(request.headers.get("cookie"));
	if (!cookie) return null;

	try {
		const { fetchBackendJsonWithTimeout } = await import("@/lib/server/backend");
		const data = await fetchBackendJsonWithTimeout<{
			user?: { subscription?: unknown; subscription_name?: unknown };
		}>("/api/auth/me", "", { headers: { cookie }, timeoutMs: 2500 });

		if (!data?.user) return null;
		return normalizeModelTier(data.user.subscription ?? data.user.subscription_name);
	} catch {
		return null;
	}
}