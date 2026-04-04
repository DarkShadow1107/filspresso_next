import { NextResponse } from "next/server";

type PromptLimitCheck = {
	allowed: boolean;
	errorResponse?: Response;
	prompts_remaining?: number;
	prompts_limit?: number;
	reset_date?: string;
	tier?: string;
	scope?: PromptScope;
};

type PromptScope = "general" | "molecule_helper";

const PYTHON_CHAT_TIMEOUT_MS = Math.max(30_000, Number.parseInt(process.env.PYTHON_CHAT_TIMEOUT_MS || "330000", 10) || 330_000);

const QWEN_THINKING_HIGH_DEMAND_MESSAGE = "Qwen 3 Thinking is in high demand right now, we're sorry for unavailability.";
const MOLSCRIBE_HIGH_DEMAND_MESSAGE = "MolScribe is in high demand right now, we're sorry for unavailability.";

function normalizeSubscriptionTier(value: unknown): string {
	return String(value || "")
		.trim()
		.toLowerCase();
}

function tierCanUseQwen(tier: string): boolean {
	return tier === "pro" || tier === "max" || tier === "ultimate";
}

function normalizePromptScope(value: unknown): PromptScope {
	const normalized = String(value || "")
		.trim()
		.toLowerCase();
	return normalized === "molecule_helper" ? "molecule_helper" : "general";
}

function buildPromptHeaders(request: Request): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	const authHeader = request.headers.get("authorization");
	if (authHeader) headers["authorization"] = authHeader;
	const fingerprint = request.headers.get("x-kafelot-fingerprint");
	if (fingerprint) headers["x-kafelot-fingerprint"] = fingerprint;
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) headers["x-forwarded-for"] = forwarded;
	const scope = request.headers.get("x-kafelot-scope");
	if (scope) headers["x-kafelot-scope"] = scope;
	return headers;
}

function chemistryUnavailablePayload(
	isImageRequest: boolean,
	requestId: string,
	limitCheck: PromptLimitCheck,
	isThinkingTier: boolean,
) {
	const message = isImageRequest
		? MOLSCRIBE_HIGH_DEMAND_MESSAGE
		: isThinkingTier
			? QWEN_THINKING_HIGH_DEMAND_MESSAGE
			: "Qwen 3 is in high demand right now, we're sorry for unavailability.";

	const modelUsed = isImageRequest ? "molscribe-unavailable-high-demand" : "qwen3-unavailable-chemistry-high-demand";

	return NextResponse.json(
		{
			response: message,
			products: [],
			smarterAI: true,
			model: "Tanka",
			model_used: modelUsed,
			mode: "Chemistry",
			request_id: requestId,
			...(typeof limitCheck.prompts_remaining === "number" ? { prompts_remaining: limitCheck.prompts_remaining } : {}),
			...(typeof limitCheck.prompts_limit === "number" ? { prompts_limit: limitCheck.prompts_limit } : {}),
			...(limitCheck.tier ? { subscription_tier: limitCheck.tier } : {}),
			...(limitCheck.scope ? { prompts_scope: limitCheck.scope } : {}),
		},
		{ status: 200 },
	);
}

async function checkPromptLimit(request: Request, dryRun: boolean, scope: PromptScope): Promise<PromptLimitCheck> {
	try {
		const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
		const headers = buildPromptHeaders(request);

		const callPromptApi = (requestHeaders: Record<string, string>) =>
			fetch(`${API_BASE}/api/kafelot/check-and-use`, {
				method: "POST",
				headers: requestHeaders,
				body: JSON.stringify({ dry_run: dryRun, scope }),
			});

		let res = await callPromptApi(headers);
		if (res.status === 401 && headers.authorization) {
			return {
				allowed: false,
				errorResponse: new Response(
					JSON.stringify({
						error: "AUTH_SESSION_INVALID",
						message: "Authentication session expired or invalid",
					}),
					{ status: 401, headers: { "Content-Type": "application/json" } },
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
				tier: normalizeSubscriptionTier(data.tier),
				scope: normalizePromptScope(data.scope || scope),
				errorResponse: new Response(
					JSON.stringify({
						error: "PROMPT_LIMIT_REACHED",
						reset_date: data.reset_date,
						prompts_limit: data.prompts_limit,
						prompts_remaining: data.prompts_remaining,
						tier: data.tier,
						scope: data.scope || scope,
					}),
					{ status: 429, headers: { "Content-Type": "application/json" } },
				),
			};
		}

		if (res.ok) {
			const data = (await res.json()) as {
				prompts_remaining?: number;
				prompts_limit?: number;
				reset_date?: string;
				tier?: string;
				scope?: string;
			};
			return {
				allowed: true,
				prompts_remaining: data.prompts_remaining,
				prompts_limit: data.prompts_limit,
				reset_date: data.reset_date,
				tier: normalizeSubscriptionTier(data.tier),
				scope: normalizePromptScope(data.scope || scope),
			};
		}

		return { allowed: true };
	} catch {
		return { allowed: true };
	}
}

export async function POST(request: Request) {
	try {
		const promptScope = normalizePromptScope(request.headers.get("x-kafelot-scope"));
		const limitCheck = await checkPromptLimit(request, true, promptScope);
		if (!limitCheck.allowed) return limitCheck.errorResponse!;

		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const contentType = request.headers.get("content-type") || "";

		// Generate a unique request ID for cancellation support
		const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		let pyBody: BodyInit;
		let pyHeaders: Record<string, string> = {};
		let modelType = "tanka_semantic";
		let isImageRequest = false;
		let isChemistryRequest = false;
		let resolvedTier = normalizeSubscriptionTier(limitCheck.tier || "");

		if (contentType.includes("multipart/form-data")) {
			// Image upload path — forward FormData to Python
			const formData = await request.formData();
			const image = formData.get("image") as File | null;
			isImageRequest = Boolean(image);
			const messagesRaw = formData.get("messages") as string;
			const messages = messagesRaw ? (JSON.parse(messagesRaw) as Array<Record<string, string>>) : [];
			const enableThinkingRaw = formData.get("enable_thinking");
			const requestTier = normalizeSubscriptionTier(formData.get("subscription"));
			resolvedTier = normalizeSubscriptionTier(limitCheck.tier || requestTier);

			modelType = (formData.get("model") as string) || "tanka_semantic";
			const mode = modelType === "tanka_chemistry" ? "chemistry" : "natural_language";
			isChemistryRequest = mode === "chemistry";
			const reqId = (formData.get("request_id") as string) || requestId;
			const useQwen = tierCanUseQwen(resolvedTier);

			// Only use the last user message for semantic embedding — joining full history produces a noisy vector
			const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
			const queryMessage = lastUserMsg?.content || messages[messages.length - 1]?.content || "";

			const pyForm = new FormData();
			pyForm.append("message", queryMessage);
			pyForm.append("mode", mode);
			pyForm.append("request_id", reqId);
			pyForm.append("use_qwen", useQwen ? "true" : "false");
			if (typeof enableThinkingRaw === "string") {
				pyForm.append("enable_thinking", enableThinkingRaw);
			}
			if (image) pyForm.append("image", image);

			pyBody = pyForm;
		} else {
			// Text-only JSON path
			const body = (await request.json()) as Record<string, unknown>;
			modelType = (body.model as string) || "tanka_semantic";
			const mode = modelType === "tanka_chemistry" ? "chemistry" : "natural_language";
			isChemistryRequest = mode === "chemistry";
			const reqId = (body.request_id as string) || requestId;
			const enableThinking = typeof body.enable_thinking === "boolean" ? body.enable_thinking : undefined;
			const requestTier = normalizeSubscriptionTier(body.subscription);
			resolvedTier = normalizeSubscriptionTier(limitCheck.tier || requestTier);
			const useQwen = tierCanUseQwen(resolvedTier);

			pyHeaders = { "Content-Type": "application/json" };
			// Only use the last user message for semantic embedding — joining full history produces a noisy vector
			const msgList = (body.messages as Array<Record<string, string>>) || [];
			const lastUserContent =
				[...msgList].reverse().find((m) => m.role === "user")?.content || msgList[msgList.length - 1]?.content || "";
			const pyPayload: Record<string, unknown> = {
				message: lastUserContent,
				mode,
				request_id: reqId,
				use_qwen: useQwen,
			};
			if (typeof enableThinking === "boolean") {
				pyPayload.enable_thinking = enableThinking;
			}
			pyBody = JSON.stringify(pyPayload);
		}

		const pythonAbortController = new AbortController();
		const timeout = setTimeout(() => pythonAbortController.abort(), PYTHON_CHAT_TIMEOUT_MS);
		let res: Response;
		try {
			res = await fetch(`${PY_HOST}/api/chat`, {
				method: "POST",
				headers: pyHeaders,
				body: pyBody,
				signal: pythonAbortController.signal,
			});
		} catch (error) {
			if (isChemistryRequest) {
				return chemistryUnavailablePayload(isImageRequest, requestId, limitCheck, resolvedTier === "ultimate");
			}
			if (
				error instanceof Error &&
				(error.name === "AbortError" || /timed out|timeout|headers?timeout/i.test(error.message || ""))
			) {
				return NextResponse.json(
					{
						error: "PYTHON_AI_TIMEOUT",
						message: "Python AI request timed out before completing.",
					},
					{ status: 504 },
				);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}

		if (!res.ok) {
			const text = await res.text();
			let errorMsg = `Python AI error: ${res.status}`;
			try {
				const errorJson = JSON.parse(text);
				errorMsg = errorJson.error || errorMsg;
			} catch {
				// Not JSON, keep status message
			}

			if (
				isChemistryRequest &&
				(res.status >= 500 || /fetch failed|timed out|timeout|unavailable|connection/i.test(errorMsg.toLowerCase()))
			) {
				return chemistryUnavailablePayload(isImageRequest, requestId, limitCheck, resolvedTier === "ultimate");
			}

			return NextResponse.json({ error: errorMsg }, { status: res.status });
		}

		const json = (await res.json()) as Record<string, unknown>;
		const modelUsed = String(json.model_used || "");
		const backendUnavailableModel = modelUsed.toLowerCase();
		const isChemistryUnavailableFromBackend =
			isChemistryRequest &&
			(backendUnavailableModel.includes("qwen3-unavailable-chemistry-high-demand") ||
				backendUnavailableModel.includes("molscribe-unavailable-high-demand"));

		// Check if request was cancelled
		if (json.cancelled) {
			return NextResponse.json({ cancelled: true, request_id: requestId }, { status: 200 });
		}

		// Consume one prompt only after a successful backend response.
		const consumed = isChemistryUnavailableFromBackend ? limitCheck : await checkPromptLimit(request, false, promptScope);
		const promptsRemaining =
			typeof consumed.prompts_remaining === "number"
				? consumed.prompts_remaining
				: typeof limitCheck.prompts_remaining === "number"
					? limitCheck.prompts_remaining
					: undefined;
		const promptsLimit =
			typeof consumed.prompts_limit === "number"
				? consumed.prompts_limit
				: typeof limitCheck.prompts_limit === "number"
					? limitCheck.prompts_limit
					: undefined;

		// Normalize Python response shape to what frontend expects
		return NextResponse.json(
			{
				response: (json.assistant_response as string) || (json.generated as string) || "",
				products: (json.products as unknown[]) || [],
				smarterAI: true,
				model: "Tanka",
				model_used: (json.model_used as string) || "Tanka",
				mode: (json.mode as string) || "",
				thinking_mode: (json.thinking_mode as string) || "",
				request_id: requestId,
				...(typeof promptsRemaining === "number" ? { prompts_remaining: promptsRemaining } : {}),
				...(typeof promptsLimit === "number" ? { prompts_limit: promptsLimit } : {}),
				...(consumed.tier
					? { subscription_tier: consumed.tier }
					: limitCheck.tier
						? { subscription_tier: limitCheck.tier }
						: {}),
				...(consumed.scope
					? { prompts_scope: consumed.scope }
					: limitCheck.scope
						? { prompts_scope: limitCheck.scope }
						: {}),
			},
			{ status: res.status },
		);
	} catch (err) {
		const rawError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		const isTimeoutLike = /aborterror|timed out|timeout|headers?timeout/i.test(rawError.toLowerCase());
		return NextResponse.json(
			{
				error: isTimeoutLike ? "PYTHON_AI_TIMEOUT" : rawError,
				message: isTimeoutLike ? "Python AI request timed out before completing." : rawError,
			},
			{ status: isTimeoutLike ? 504 : 502 },
		);
	}
}

// Cancel endpoint
export async function DELETE(request: Request) {
	try {
		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const { searchParams } = new URL(request.url);
		const requestId = searchParams.get("request_id");

		if (!requestId) {
			return NextResponse.json({ error: "request_id is required" }, { status: 400 });
		}

		const res = await fetch(`${PY_HOST}/api/cancel/${requestId}`, {
			method: "POST",
		});
		const json = await res.json();

		return NextResponse.json(json, { status: res.status });
	} catch (err) {
		return NextResponse.json({ error: String(err) }, { status: 502 });
	}
}
