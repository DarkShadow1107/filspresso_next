import { buildBackendUrl, buildForwardedCookieHeader } from "@/lib/server/backend";
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
	/** Per-model metering, present only when a model key was supplied. */
	model_key?: string;
	model_prompts_remaining?: number;
	model_prompts_limit?: number;
	model_prompts_used?: number;
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
	model_key?: string;
	prompts_used?: number;
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
 * A model's own allowance is spent, while the plan total may still have room.
 *
 * Deliberately distinct from `PROMPT_LIMIT_REACHED`: that one means "you are out of
 * prompts" and the UI must stop the user entirely, whereas this means "pick another
 * model". Collapsing the two would tell an ULTIMATE user with 120/1000 prompts left
 * that they are out of prompts.
 */
function modelAllowancePayload(data: LimitPayload & { error?: string; model_key?: string }, scope: PromptScope) {
	return {
		error: data.error === "MODEL_NOT_IN_PLAN" ? "MODEL_NOT_IN_PLAN" : "MODEL_ALLOWANCE_EXHAUSTED",
		message:
			data.error === "MODEL_NOT_IN_PLAN"
				? "That model is not included in your plan."
				: "You have used all of this model's prompts for this period. Please choose another model.",
		model_key: data.model_key,
		prompts_remaining: data.prompts_remaining,
		prompts_limit: data.prompts_limit,
		prompts_used: (data as { prompts_used?: number }).prompts_used,
		reset_date: data.reset_date,
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
	/**
	 * The model that will serve this request, for per-model metering.
	 *
	 * Optional: omit it and only the plan total is checked. The initial dry-run
	 * passes nothing on purpose -- at that point the model has not been resolved yet.
	 */
	modelKey?: string | null,
): Promise<PromptLimitCheck> {
	let promptLimitUrl = "";
	try {
		promptLimitUrl = new URL("/api/kafelot/check-and-use", resolveSelfCallOrigin()).toString();
		const headers = buildPromptHeaders(request, scope);

		const res = await fetch(promptLimitUrl, {
			method: "POST",
			headers,
			body: JSON.stringify({ dry_run: dryRun, scope, ...(modelKey ? { model_key: modelKey } : {}) }),
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

		if (res.status === 429 || res.status === 403 || res.status === 402) {
			const data = (await res.json()) as {
				error?: string;
				message?: string;
				// Present only on a 402: the money picture, as opposed to the prompt counter.
				allowance_remaining_ron?: number;
				balance_ron?: number;
				reset_date?: string;
				prompts_limit?: number;
				prompts_remaining?: number;
				tier?: string;
				scope?: string;
				model_key?: string;
				prompts_used?: number;
			};
			// Per-model exhaustion is not plan exhaustion; keep the two distinguishable.
			if (data.error === "MODEL_ALLOWANCE_EXHAUSTED" || data.error === "MODEL_NOT_IN_PLAN") {
				return {
					allowed: false,
					model_key: data.model_key,
					model_prompts_remaining: data.prompts_remaining,
					model_prompts_limit: data.prompts_limit,
					model_prompts_used: data.prompts_used,
					prompts_remaining: data.prompts_remaining,
					prompts_limit: data.prompts_limit,
					reset_date: data.reset_date,
					tier: data.tier,
					scope: (data.scope as PromptScope) || scope,
					errorResponse: Response.json(modelAllowancePayload(data, scope), {
						status: data.error === "MODEL_NOT_IN_PLAN" ? 403 : 429,
						headers: { "Cache-Control": "no-store" },
					}),
				};
			}
			if (res.status === 402) {
				// Out of money, not out of prompts.
				//
				// Without this the 402 fell through to the generic quota branch below and was
				// answered as a 429 "limit reached" -- telling a customer whose allowance and
				// wallet are both empty that they had used a quota they never had. The two
				// states need different words and different actions: one is fixed by
				// upgrading or topping up, the other by waiting.
				return {
					allowed: false,
					tier: data.tier,
					errorResponse: Response.json(
						{
							error: "INSUFFICIENT_BALANCE",
							message:
								data.message ||
								"Your monthly AI allowance and wallet are both spent for this month.",
							allowance_remaining_ron: data.allowance_remaining_ron ?? 0,
							balance_ron: data.balance_ron ?? 0,
							// What the page should offer, decided server-side so the client is not
							// guessing from a status code.
							action: data.balance_ron === 0 ? "top_up_or_upgrade" : "top_up",
						},
						{ status: 402, headers: { "Cache-Control": "no-store" } },
					),
				};
			}
			if (res.status === 403) {
				// Some other 403 (e.g. the chemistry gate) is not a quota problem, so
				// pass the backend's own payload through untouched.
				return { allowed: false, errorResponse: Response.json(data, { status: 403, headers: { "Cache-Control": "no-store" } }) };
			}
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
			model_key?: string;
			model_prompts_remaining?: number;
			model_prompts_limit?: number;
			model_prompts_used?: number;
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
			model_key: data.model_key,
			model_prompts_remaining: data.model_prompts_remaining,
			model_prompts_limit: data.model_prompts_limit,
			model_prompts_used: data.model_prompts_used,
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

/**
 * The money gate, checked before any GPU work.
 *
 * Replaces the prompt-quota check the Playground used to make. That check asked
 * "PROMPT_LIMIT_REACHED", which the backend no longer returns for an authenticated
 * caller, so it had become a no-op that still looked like a control. The real budget is
 * money, and it lives at /api/billing/can-generate.
 *
 * Deliberately *fails open* when the backend cannot be reached. The two failure modes are
 * not symmetric: refusing every prompt because a status endpoint timed out is a total
 * outage, while serving one unmetered prompt is a lost fraction of a penny. The
 * post-generation usage report is what actually bills, and it will still run.
 */
export async function checkCanGenerate(request: Request): Promise<{
	allowed: boolean;
	reason?: string;
	allowanceRemainingRon?: number;
	balanceRon?: number;
}> {
	const cookie = buildForwardedCookieHeader(request.headers.get("cookie"));
	// Anonymous callers are not gated here. They spend a fingerprint-keyed allowance that
	// the billing service enforces on the report itself, and there is no session to ask
	// about. A subscriber is the case that matters: it is the one that can spend a wallet.
	if (!cookie) return { allowed: true, reason: "anonymous" };

	// Called directly on the backend, not through a Next route of the same path.
	//
	// There is no /api/billing/can-generate route in this app, so the self-call 404'd, the
	// `!res.ok` branch below returned `allowed: true`, and the money gate was a no-op that
	// still read like a control. It failed open on every single request.
	//
	// An outage must not read as "free", so an unreachable backend denies. The caller
	// distinguishes the two refusals and answers 503 rather than 402, because telling a
	// paying customer they have no money when the billing service is simply down is its own
	// kind of wrong.
	try {
		const res = await fetch(buildBackendUrl("/api/billing/can-generate"), {
			headers: { cookie, accept: "application/json" },
			cache: "no-store",
		});
		if (res.status === 401) return { allowed: false, reason: "session_gone" };
		if (!res.ok) return { allowed: false, reason: `status_${res.status}` };

		const data = (await res.json()) as {
			canGenerate?: boolean;
			allowanceRemainingRon?: number;
			balanceRon?: number;
		};
		// Echoed back on the stream headers, replacing a prompts-remaining pair that
		// described a quota which no longer exists.
		const state = { allowanceRemainingRon: data.allowanceRemainingRon, balanceRon: data.balanceRon };
		if (data.canGenerate === false) return { allowed: false, reason: "no_balance", ...state };
		return { allowed: true, ...state };
	} catch {
		return { allowed: false, reason: "unreachable" };
	}
}
