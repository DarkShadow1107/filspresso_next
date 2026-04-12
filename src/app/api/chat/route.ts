import { NextRequest, NextResponse } from "next/server";
import { coffeeCollections } from "@/data/coffee";
import type { CoffeeProduct } from "@/data/coffee";
import tankaFallback from "@/app/data/coffee-fallback-tanka.json";

type ModelTier = "tanka";

interface ModelConfig {
	name: string;
	parameters: string;
	contextWindow: number;
	knowledgeDepth: number;
	responseDetail: "basic" | "balanced" | "comprehensive";
	specializations: string[];
	description: string;
}

const MODEL_CONFIGS: Record<ModelTier, ModelConfig> = {
	tanka: {
		name: "Kafelot",
		parameters: "30M",
		contextWindow: 12,
		knowledgeDepth: 0.75,
		responseDetail: "basic",
		specializations: ["Quick answers", "Recipe suggestions", "Basic brewing tips"],
		description: "Fast and efficient for common coffee questions.",
	},
};

type CoffeeFallbackAnswerSet = {
	brewing: string;
	caffeine: string;
	roasting: string;
	origins: string;
	health: string;
	intensity: { strong: string; mild: string };
	flavor: { sweet: string; fruity: string };
	time: { morning: string; evening: string };
	comparison: string;
	recommendation: string;
	fuzzy: { found: string; none: string };
};

type CoffeeFallbackModelData = {
	greetings: string[];
	fallback: string;
	answers: CoffeeFallbackAnswerSet;
};

const FALLBACK_DATA: Record<ModelTier, CoffeeFallbackModelData> = {
	tanka: tankaFallback as CoffeeFallbackModelData,
};

async function generateCoffeeResponseByModel(
	input: string,
	model: ModelTier,
): Promise<{ response: string; products: CoffeeProduct[] }> {
	const lower = input.toLowerCase();
	const collections = coffeeCollections;
	const allProducts = collections.flatMap((c) => c.groups.flatMap((g) => g.products));
	const config = MODEL_CONFIGS[model];
	const modelData = FALLBACK_DATA[model];
	const answers = modelData.answers;
	let response = "";
	let suggestedProducts: CoffeeProduct[] = [];

	if (/(hello|hi|hey)/i.test(lower)) {
		const greetings = modelData.greetings;
		const greeting = greetings[Math.floor(Math.random() * greetings.length)] ?? greetings[0];
		return { response: greeting ?? `☕ Hello from ${config.name}!`, products: [] };
	}

	if (/brew|make|preparation|extract/i.test(lower)) {
		response = answers.brewing;
		return { response, products: [] };
	}

	if (/caffeine|energy|stimulant/i.test(lower)) {
		response = answers.caffeine;
		return { response, products: [] };
	}

	if (/roast|roasting|dark|light|medium/i.test(lower)) {
		response = answers.roasting;
		return { response, products: [] };
	}

	if (
		/origin|terroir|ethiopia|colombia|brazil|kenya|region|country|single\s*origin|where\s+(does|do|should).*(coffee)?\s*grow/i.test(
			lower,
		)
	) {
		response = answers.origins;
		return { response, products: [] };
	}

	if (/health|benefit|antioxidant|metabolism|liver|diabetes|wellness|nutrition/i.test(lower)) {
		response = answers.health;
		return { response, products: [] };
	}

	if (/strong|intense|bold/i.test(lower)) {
		const strong = allProducts.filter((p) => (p.intensity ?? 0) >= 10).slice(0, 4);
		response = answers.intensity.strong;
		suggestedProducts = strong;
		return { response, products: suggestedProducts };
	}

	if (/mild|light|gentle|smooth/i.test(lower)) {
		const mild = allProducts.filter((p) => (p.intensity ?? 0) <= 6).slice(0, 4);
		response = answers.intensity.mild;
		suggestedProducts = mild;
		return { response, products: suggestedProducts };
	}

	if (/chocolate|sweet|dessert|caramel|honey|toffee|syrup/i.test(lower)) {
		response = answers.flavor.sweet;
		return { response, products: [] };
	}

	if (/fruit|citrus|berry|floral|bright|tangy|juicy/i.test(lower)) {
		response = answers.flavor.fruity;
		return { response, products: [] };
	}

	if (/morning|breakfast|wake\s*up|start\s*day/i.test(lower)) {
		response = answers.time.morning;
		return { response, products: [] };
	}

	if (/evening|night|after\s*dinner|late/i.test(lower)) {
		response = answers.time.evening;
		return { response, products: [] };
	}

	if (/original.*vertuo|vertuo.*original|difference.*system|compare.*line/i.test(lower)) {
		response = answers.comparison;
		return { response, products: [] };
	}

	if (/recommend|suggest|best|popular|favorite|top/i.test(lower)) {
		const topPicks = allProducts.filter((p) =>
			["livanto", "arpeggio", "volluto", "ethiopia", "kazaar", "paris"].some((name) =>
				p.name?.toLowerCase().includes(name),
			),
		);
		response = answers.recommendation;
		suggestedProducts = topPicks.slice(0, 5);
		return { response, products: suggestedProducts };
	}

	const tokens = lower.split(/\s+/).filter((w) => w.length > 3);
	const matches = allProducts.filter((p) =>
		tokens.some(
			(t) =>
				p.name?.toLowerCase().includes(t) ||
				p.description?.toLowerCase().includes(t) ||
				p.notes?.some((n) => n.toLowerCase().includes(t)),
		),
	);

	if (matches.length > 0) {
		response = `${answers.fuzzy.found} (${matches.length} match${matches.length === 1 ? "" : "es"})`;
		suggestedProducts = matches.slice(0, 4);
	} else {
		response = modelData.fallback;
	}

	return { response, products: suggestedProducts };
}

async function checkPromptLimit(
	request: NextRequest,
	dryRun: boolean,
): Promise<{
	allowed: boolean;
	errorResponse?: ReturnType<typeof NextResponse.json>;
	prompts_remaining?: number;
	prompts_limit?: number;
	tier?: string;
	scope?: "general" | "molecule_helper";
}> {
	try {
		const normalizePromptScope = (value: unknown): "general" | "molecule_helper" => {
			const normalized = String(value || "")
				.trim()
				.toLowerCase();
			return normalized === "molecule_helper" ? "molecule_helper" : "general";
		};

		const scope = normalizePromptScope(request.headers.get("x-kafelot-scope"));
		const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		const authHeader = request.headers.get("authorization");
		if (authHeader) headers["authorization"] = authHeader;
		const fingerprint = request.headers.get("x-kafelot-fingerprint");
		if (fingerprint) headers["x-kafelot-fingerprint"] = fingerprint;
		const forwarded = request.headers.get("x-forwarded-for");
		if (forwarded) headers["x-forwarded-for"] = forwarded;
		headers["x-kafelot-scope"] = scope;

		const res = await fetch(`${API_BASE}/api/kafelot/check-and-use`, {
			method: "POST",
			headers,
			body: JSON.stringify({ dry_run: dryRun, scope }),
		});

		if (res.status === 401 && authHeader) {
			return {
				allowed: false,
				errorResponse: NextResponse.json(
					{ error: "AUTH_SESSION_INVALID", message: "Authentication session expired or invalid" },
					{ status: 401 },
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
				errorResponse: NextResponse.json(
					{
						error: "PROMPT_LIMIT_REACHED",
						reset_date: data.reset_date,
						prompts_limit: data.prompts_limit,
						prompts_remaining: data.prompts_remaining,
						tier: data.tier,
						scope: data.scope || scope,
					},
					{ status: 429 },
				),
				prompts_remaining: data.prompts_remaining,
				prompts_limit: data.prompts_limit,
				tier: data.tier,
				scope: normalizePromptScope(data.scope || scope),
			};
		}
		if (res.ok) {
			const data = (await res.json()) as {
				prompts_remaining?: number;
				prompts_limit?: number;
				tier?: string;
				scope?: string;
			};
			return {
				allowed: true,
				prompts_remaining: data.prompts_remaining,
				prompts_limit: data.prompts_limit,
				tier: data.tier,
				scope: normalizePromptScope(data.scope || scope),
			};
		}

		return { allowed: true };
	} catch {
		// On infra error, allow the request to proceed
		return { allowed: true };
	}
}

export async function POST(request: NextRequest) {
	try {
		const limitCheck = await checkPromptLimit(request, true);
		if (!limitCheck.allowed) return limitCheck.errorResponse!;

		const { messages } = (await request.json()) as {
			messages: Array<{ role: string; content: string }>;
		};
		const userMessage = messages[messages.length - 1]?.content || "";
		const selectedModel: ModelTier = "tanka";
		const result = await generateCoffeeResponseByModel(userMessage, selectedModel);

		const consumed = await checkPromptLimit(request, false);
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

		return NextResponse.json({
			response: result.response,
			products: result.products,
			model: selectedModel,
			model_used: "Local Kafelot fallback",
			mode: "coffee",
			smarterAI: false,
			...(typeof promptsRemaining === "number" ? { prompts_remaining: promptsRemaining } : {}),
			...(typeof promptsLimit === "number" ? { prompts_limit: promptsLimit } : {}),
		});
	} catch (error) {
		console.error("Chat API error:", error);
		return NextResponse.json({ error: "Failed to process chat request" }, { status: 500 });
	}
}
