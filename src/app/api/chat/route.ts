import { NextRequest, NextResponse } from "next/server";
import { coffeeCollections, type CoffeeProduct } from "@/data/coffee";
import tankaFallback from "@/app/data/coffee-fallback-tanka.json";
import villanelleFallback from "@/app/data/coffee-fallback-villanelle.json";
import odeFallback from "@/app/data/coffee-fallback-ode.json";

type ModelTier = "tanka" | "villanelle" | "ode";

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
		name: "Tanka",
		parameters: "30M",
		contextWindow: 12,
		knowledgeDepth: 0.75,
		responseDetail: "basic",
		specializations: ["Quick answers", "Recipe suggestions", "Basic brewing tips"],
		description: "Fast and efficient for common coffee questions.",
	},
	villanelle: {
		name: "Villanelle",
		parameters: "60M",
		contextWindow: 28,
		knowledgeDepth: 0.88,
		responseDetail: "balanced",
		specializations: ["Detailed recommendations", "Processing insights", "Sensory descriptions"],
		description: "Balanced expertise for most coffee conversations.",
	},
	ode: {
		name: "Ode",
		parameters: "90M",
		contextWindow: 48,
		knowledgeDepth: 0.96,
		responseDetail: "comprehensive",
		specializations: ["Coffee chemistry", "Biology and effects", "Historical context"],
		description: "Deep coffee knowledge and comprehensive explanations.",
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
	villanelle: villanelleFallback as CoffeeFallbackModelData,
	ode: odeFallback as CoffeeFallbackModelData,
};

function generateCoffeeResponseByModel(input: string, model: ModelTier): { response: string; products: CoffeeProduct[] } {
	const lower = input.toLowerCase();
	const allProducts = coffeeCollections.flatMap((c) => c.groups.flatMap((g) => g.products));
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
			lower
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
			["livanto", "arpeggio", "volluto", "ethiopia", "kazaar", "paris"].some((name) => p.name?.toLowerCase().includes(name))
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
				p.notes?.some((n) => n.toLowerCase().includes(t))
		)
	);

	if (matches.length > 0) {
		response = `${answers.fuzzy.found} (${matches.length} match${matches.length === 1 ? "" : "es"})`;
		suggestedProducts = matches.slice(0, 4);
	} else {
		response = modelData.fallback;
	}

	return { response, products: suggestedProducts };
}

type UserSubscription = "none" | "basic" | "pro" | "max" | "ultimate";

function getModelAccessLevel(subscription: UserSubscription): ModelTier {
	switch (subscription) {
		case "ultimate":
			return "ode";
		case "max":
			return "villanelle";
		default:
			return "tanka";
	}
}

export async function POST(request: NextRequest) {
	try {
		const { messages, model, subscription } = (await request.json()) as {
			messages: Array<{ role: string; content: string }>;
			model?: ModelTier;
			subscription?: UserSubscription;
		};
		const userMessage = messages[messages.length - 1]?.content || "";
		const requestedModel = model || "villanelle";
		const maxAllowedModel = getModelAccessLevel(subscription || "none");
		const modelHierarchy: Record<ModelTier, number> = { tanka: 1, villanelle: 2, ode: 3 };
		const canAccess = modelHierarchy[requestedModel] <= modelHierarchy[maxAllowedModel];
		const selectedModel: ModelTier = canAccess ? requestedModel : maxAllowedModel;
		const result = generateCoffeeResponseByModel(userMessage, selectedModel);
		return NextResponse.json({
			response: result.response,
			products: result.products,
			model: selectedModel,
			mode: "coffee",
			smarterAI: false,
		});
	} catch (error) {
		console.error("Chat API error:", error);
		return NextResponse.json({ error: "Failed to process chat request" }, { status: 500 });
	}
}
