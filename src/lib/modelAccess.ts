/**
 * Canonical Kafelot model access table.
 *
 * The tier -> model mapping must agree across the Kafelot UI (which decides
 * what to render) and every server route that acts on a model key (which
 * decides what to accept). Duplicating the table is how the routes end up
 * disagreeing with the UI, so it lives here and both sides import it.
 *
 * Server routes must still treat this as a UX affordance only: the authoritative
 * check happens against the live session in the backend, and /api/python-chat
 * re-resolves the requested model through these same tables before proxying.
 *
 * Lineup note: the previous Gemma 3 1B and LFM 2 Vision 450M entries are gone.
 * MiniLM-L6-v2 is still loaded, but as the internal retrieval embedder for
 * coffee_facts -- it is no longer offered as a chat model.
 */

export const TEXT_MODEL_230M = "lfm2_5_230m_q4_k_m";
export const TEXT_MODEL_350M = "lfm2_5_350m_q8_0";
export const TEXT_MODEL_1_2B_INSTRUCT = "lfm2_5_1_2b_instruct_q4_k_m";
export const TEXT_MODEL_1_2B_THINKING = "lfm2_5_1_2b_thinking_q4_k_m";
export const TEXT_MODEL_2_6B = "lfm2_5_2_6b_q4_0";
export const TEXT_MODEL_8B = "lfm2_5_8b_a1b_q4_k_m";
export const VISION_MODEL_450M = "lfm2_5_vl_450m_q4_k_m";
export const VISION_MODEL_3B = "lfm2_5_vl_3b_q4_k_m";
export const AUDIO_MODEL_1_5B = "lfm2_5_audio_1_5b_q4_0";

export type TextModelKey =
	| typeof TEXT_MODEL_230M
	| typeof TEXT_MODEL_350M
	| typeof TEXT_MODEL_1_2B_INSTRUCT
	| typeof TEXT_MODEL_1_2B_THINKING
	| typeof TEXT_MODEL_2_6B
	| typeof TEXT_MODEL_8B;
export type VisionModelKey = typeof VISION_MODEL_450M | typeof VISION_MODEL_3B;
export type AudioModelKey = typeof AUDIO_MODEL_1_5B;
export type ModelKey = TextModelKey | VisionModelKey | AudioModelKey;

export type ModelModality = "text" | "vision" | "audio";

export type UserSubscriptionTier = "none" | "free" | "basic" | "plus" | "pro" | "max" | "ultimate";

/** GGUF file name the Python AI service expects for each model key. */
export const MODEL_FILE_BY_KEY: Record<ModelKey, string> = {
	[TEXT_MODEL_230M]: "LFM2.5-230M-Q4_K_M.gguf",
	[TEXT_MODEL_350M]: "LFM2.5-350M-Q8_0.gguf",
	[TEXT_MODEL_1_2B_INSTRUCT]: "LFM2.5-1.2B-Instruct-Q4_K_M.gguf",
	[TEXT_MODEL_1_2B_THINKING]: "LFM2.5-1.2B-Thinking-Q4_K_M.gguf",
	[TEXT_MODEL_2_6B]: "LFM2.5-2.6B-Q4_0.gguf",
	[TEXT_MODEL_8B]: "LFM2.5-8B-A1B-Q4_K_M.gguf",
	[VISION_MODEL_450M]: "LFM2.5-VL-450M-Q4_K_M.gguf",
	[VISION_MODEL_3B]: "LFM2.5-VL-3B-Q4_K_M.gguf",
	[AUDIO_MODEL_1_5B]: "LFM2.5-Audio-1.5B-Q4_0.gguf",
};

export const MODEL_LABEL_BY_KEY: Record<ModelKey, string> = {
	[TEXT_MODEL_230M]: "LFM 2.5 230M",
	[TEXT_MODEL_350M]: "LFM 2.5 350M",
	[TEXT_MODEL_1_2B_INSTRUCT]: "LFM 2.5 1.2B Instruct",
	[TEXT_MODEL_1_2B_THINKING]: "LFM 2.5 1.2B Thinking",
	[TEXT_MODEL_2_6B]: "LFM 2.5 2.6B",
	[TEXT_MODEL_8B]: "LFM 2.5 8B A1B",
	[VISION_MODEL_450M]: "LFM 2.5 VL 450M",
	[VISION_MODEL_3B]: "LFM 2.5 VL 3B",
	[AUDIO_MODEL_1_5B]: "LFM 2.5 Audio 1.5B",
};

export const MODEL_MODALITY_BY_KEY: Record<ModelKey, ModelModality> = {
	[TEXT_MODEL_230M]: "text",
	[TEXT_MODEL_350M]: "text",
	[TEXT_MODEL_1_2B_INSTRUCT]: "text",
	[TEXT_MODEL_1_2B_THINKING]: "text",
	[TEXT_MODEL_2_6B]: "text",
	[TEXT_MODEL_8B]: "text",
	[VISION_MODEL_450M]: "vision",
	[VISION_MODEL_3B]: "vision",
	[AUDIO_MODEL_1_5B]: "audio",
};

export const MODEL_DESCRIPTION_BY_KEY: Record<ModelKey, string> = {
	[TEXT_MODEL_230M]: "Smallest and fastest. Included on every plan.",
	[TEXT_MODEL_350M]: "Higher quality text, a little slower.",
	[TEXT_MODEL_1_2B_INSTRUCT]: "Balanced instruct model for everyday chat.",
	[TEXT_MODEL_1_2B_THINKING]: "Shows its reasoning before answering.",
	[TEXT_MODEL_2_6B]: "Strong general chat. Heavier, best for nuance.",
	[TEXT_MODEL_8B]: "Most capable. Mixture-of-experts, slowest.",
	[VISION_MODEL_450M]: "Image understanding, 450M.",
	[VISION_MODEL_3B]: "Sharper image understanding, 3B.",
	[AUDIO_MODEL_1_5B]: "Speech and audio input/output.",
};

const TEXT_MODEL_KEYS: TextModelKey[] = [
	TEXT_MODEL_230M,
	TEXT_MODEL_350M,
	TEXT_MODEL_1_2B_INSTRUCT,
	TEXT_MODEL_1_2B_THINKING,
	TEXT_MODEL_2_6B,
	TEXT_MODEL_8B,
];
const VISION_MODEL_KEYS: VisionModelKey[] = [VISION_MODEL_450M, VISION_MODEL_3B];
const AUDIO_MODEL_KEYS: AudioModelKey[] = [AUDIO_MODEL_1_5B];

const TEXT_MODEL_KEY_SET = new Set<string>(TEXT_MODEL_KEYS);
const VISION_MODEL_KEY_SET = new Set<string>(VISION_MODEL_KEYS);
const AUDIO_MODEL_KEY_SET = new Set<string>(AUDIO_MODEL_KEYS);

export function isVisionModelKey(value: string): value is VisionModelKey {
	return VISION_MODEL_KEY_SET.has(value);
}

export function isAudioModelKey(value: string): value is AudioModelKey {
	return AUDIO_MODEL_KEY_SET.has(value);
}

export function isTextModelKey(value: string): value is TextModelKey {
	return TEXT_MODEL_KEY_SET.has(value);
}

const KNOWN_TIERS = new Set<UserSubscriptionTier>([
	"none",
	"free",
	"basic",
	"plus",
	"pro",
	"max",
	"ultimate",
]);

/**
 * Normalizes a subscription string from the database (`Free`, `Ultimate`, ...)
 * or a request body into a known tier.
 *
 * `none` collapses to `free` because "no subscription record" and "free plan"
 * grant exactly the same model access.
 */
export function normalizeModelTier(rawTier: unknown, fallback: UserSubscriptionTier = "none"): UserSubscriptionTier {
	const normalized = typeof rawTier === "string" ? rawTier.trim().toLowerCase() : "";
	if (!normalized) return fallback;
	if (normalized === "none") return "free";
	if (KNOWN_TIERS.has(normalized as UserSubscriptionTier)) {
		return normalized as UserSubscriptionTier;
	}
	return fallback;
}

/**
 * Explicit entitlement matrix. Written out rather than derived from an ordering
 * so the answer to "who gets 8B?" is readable without evaluating the code, and
 * so the `basic` no-vision rule is stated rather than implied by an off-by-one.
 */
/** Tier entitlements per model. Exported so feature gating derives from the same table. */
export const MODEL_TIERS: Record<ModelKey, readonly UserSubscriptionTier[]> = {
	[TEXT_MODEL_230M]: ["free", "basic", "plus", "pro", "max", "ultimate"],
	[TEXT_MODEL_350M]: ["basic", "plus", "pro", "max", "ultimate"],
	[TEXT_MODEL_1_2B_INSTRUCT]: ["plus", "pro", "max", "ultimate"],
	[TEXT_MODEL_1_2B_THINKING]: ["pro", "max", "ultimate"],
	[TEXT_MODEL_2_6B]: ["max", "ultimate"],
	[TEXT_MODEL_8B]: ["ultimate"],
	[VISION_MODEL_450M]: ["plus", "pro", "max", "ultimate"],
	[VISION_MODEL_3B]: ["max", "ultimate"],
	[AUDIO_MODEL_1_5B]: ["ultimate"],
};

export function tierAllowsModel(tier: UserSubscriptionTier, modelKey: ModelKey): boolean {
	return MODEL_TIERS[modelKey]?.includes(tier) ?? false;
}

export function allowedModelsForTier(tier: UserSubscriptionTier): ModelKey[] {
	return (Object.keys(MODEL_TIERS) as ModelKey[]).filter((key) => tierAllowsModel(tier, key));
}

export function allowedTextModelsForTier(tier: UserSubscriptionTier): TextModelKey[] {
	return allowedModelsForTier(tier).filter((key): key is TextModelKey => TEXT_MODEL_KEY_SET.has(key));
}

export function allowedVisionModelsForTier(tier: UserSubscriptionTier): VisionModelKey[] {
	return allowedModelsForTier(tier).filter((key): key is VisionModelKey => VISION_MODEL_KEY_SET.has(key));
}

export function allowedAudioModelsForTier(tier: UserSubscriptionTier): AudioModelKey[] {
	return allowedModelsForTier(tier).filter((key): key is AudioModelKey => AUDIO_MODEL_KEY_SET.has(key));
}

/** Cheapest model a tier may use. This is the default selection for that tier. */
export function defaultModelForTier(tier: UserSubscriptionTier): ModelKey {
	return tierAllowsModel(tier, TEXT_MODEL_230M) ? TEXT_MODEL_230M : TEXT_MODEL_350M;
}

/** True when the tier may use a model that emits visible reasoning. */
export function tierCanUseThinkingModel(tier: UserSubscriptionTier): boolean {
	return tierAllowsModel(tier, TEXT_MODEL_1_2B_THINKING) || tierAllowsModel(tier, TEXT_MODEL_8B);
}

/**
 * Monthly prompt allowance per model per tier.
 *
 * Each value is a ceiling *for that model alone*, never a share of a shared
 * pool, and each is at or below the plan's overall headline limit in
 * `kafelot.service.ts` (free 15 / basic 50 / plus 100 / pro 150 / max 300 /
 * ultimate 1000). Bigger models get smaller allowances because they hold the
 * single llama.cpp slot for longer.
 *
 * `0` means "not entitled on this plan" and is rendered as unavailable rather
 * than as an exhausted quota, so it cannot be confused with a used-up limit.
 */
export const MODEL_MONTHLY_LIMITS: Record<ModelKey, Record<string, number>> = {
	[TEXT_MODEL_230M]: { free: 15, basic: 50, plus: 100, pro: 150, max: 300, ultimate: 1000 },
	[TEXT_MODEL_350M]: { basic: 40, plus: 80, pro: 120, max: 240, ultimate: 800 },
	[TEXT_MODEL_1_2B_INSTRUCT]: { plus: 60, pro: 90, max: 180, ultimate: 600 },
	[TEXT_MODEL_1_2B_THINKING]: { pro: 60, max: 120, ultimate: 400 },
	[TEXT_MODEL_2_6B]: { max: 90, ultimate: 300 },
	[TEXT_MODEL_8B]: { ultimate: 120 },
	[VISION_MODEL_450M]: { plus: 50, pro: 70, max: 140, ultimate: 450 },
	[VISION_MODEL_3B]: { max: 70, ultimate: 220 },
	[AUDIO_MODEL_1_5B]: { ultimate: 150 },
};

/** Monthly allowance for one model on one plan, or 0 when not entitled. */
export function monthlyLimitForModelTier(tier: UserSubscriptionTier, modelKey: ModelKey): number {
	if (!tierAllowsModel(tier, modelKey)) return 0;
	return MODEL_MONTHLY_LIMITS[modelKey]?.[tier] ?? 0;
}

/**
 * Emoji prefixes the marketing pages key their icons off.
 *
 * `SubscriptionPageContent` picks an icon by scanning the leading emoji and then
 * strips it before display, so these prefixes are load-bearing rather than
 * decoration. The vision/audio prefixes must stay in its `getIcon` chain.
 */
const MODALITY_EMOJI: Record<ModelModality, string> = {
	text: "\u{1F9E0}",
	vision: "\u{1F4F7}",
	audio: "\u{1F3BC}",
};

/** Model keys in the order a plan should advertise them (cheapest first). */
const MODEL_DISPLAY_ORDER: ModelKey[] = [
	TEXT_MODEL_230M,
	TEXT_MODEL_350M,
	TEXT_MODEL_1_2B_INSTRUCT,
	TEXT_MODEL_1_2B_THINKING,
	TEXT_MODEL_2_6B,
	TEXT_MODEL_8B,
	VISION_MODEL_450M,
	VISION_MODEL_3B,
	AUDIO_MODEL_1_5B,
];

/**
 * The models a plan includes, as ready-to-render benefit lines.
 *
 * Derived from `tierAllowsModel` and `MODEL_MONTHLY_LIMITS` rather than
 * hand-written, because the hand-written lists drifted away from what is actually
 * enforced: they still advertised the deleted Gemma 3, and promised vision access
 * on Basic, which the entitlement matrix does not grant. Deriving the copy makes
 * that class of bug impossible.
 */
export function modelAccessLinesForTier(tier: UserSubscriptionTier): string[] {
	return MODEL_DISPLAY_ORDER.filter((key) => tierAllowsModel(tier, key)).map((key) => {
		const limit = monthlyLimitForModelTier(tier, key);
		const label = MODEL_LABEL_BY_KEY[key];
		const suffix = limit > 0 ? ` - ${limit} prompts/month` : "";
		return `${MODALITY_EMOJI[MODEL_MODALITY_BY_KEY[key]]} ${label}${suffix}`;
	});
}

/** One-line summary of a plan's model access, for compact layouts. */
export function modelAccessSummaryForTier(tier: UserSubscriptionTier): string {
	const lines = modelAccessLinesForTier(tier);
	if (!lines.length) return "No models included on this plan.";
	return lines.map((line) => line.replace(/^\S+\s+/, "")).join(" · ");
}
