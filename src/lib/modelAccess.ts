/**
 * Canonical model access table.
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
 * LFM 2.5 is not selectable in either Playground. Its recorded/API rates remain
 * available for history; Kafelot keeps its separate Free-plan 230M entitlement.
 * All selectable Playground models are LFM 3, served with a 256K context window.
 */

export const TEXT_MODEL_230M = "lfm2_5_230m_q4_k_m";
export const TEXT_MODEL_1_7B = "lfm3_1_7b_q4_k_m";
export const VISION_MODEL_2B = "lfm3_vl_2b_q4_k_m";
export const AUDIO_MODEL_2B = "lfm3_audio_2b_q4_k_m";
export const OMNI_MODEL_2B = "lfm3_omni_2b_q4_k_m";

export type TextModelKey = typeof TEXT_MODEL_230M | typeof TEXT_MODEL_1_7B;
export type VisionModelKey = typeof VISION_MODEL_2B;
export type AudioModelKey = typeof AUDIO_MODEL_2B;
export type OmniModelKey = typeof OMNI_MODEL_2B;
export type ModelKey = TextModelKey | VisionModelKey | AudioModelKey | OmniModelKey;

export type ModelModality = "text" | "vision" | "audio" | "omni";

export type UserSubscriptionTier = "none" | "free" | "basic" | "plus" | "pro" | "max" | "ultimate";

/** GGUF file name the Python AI service expects for each model key. */
export const MODEL_FILE_BY_KEY: Record<ModelKey, string> = {
	[TEXT_MODEL_230M]: "LFM2.5-230M-Q4_K_M.gguf",
	[TEXT_MODEL_1_7B]: "LFM3-1.7B-Q4_K_M.gguf",
	[VISION_MODEL_2B]: "LFM3-VL-2B-Q4_K_M.gguf",
	[AUDIO_MODEL_2B]: "LFM3-Audio-2B-Q4_K_M.gguf",
	[OMNI_MODEL_2B]: "LFM3-Omni-2B-Q4_K_M.gguf",
};

export const MODEL_LABEL_BY_KEY: Record<ModelKey, string> = {
	[TEXT_MODEL_230M]: "LFM 2.5 230M",
	[TEXT_MODEL_1_7B]: "LFM 3 1.7B",
	[VISION_MODEL_2B]: "LFM 3 VL 2B",
	[AUDIO_MODEL_2B]: "LFM 3 Audio 2B",
	[OMNI_MODEL_2B]: "LFM 3 Omni 2B",
};

export const MODEL_MODALITY_BY_KEY: Record<ModelKey, ModelModality> = {
	[TEXT_MODEL_230M]: "text",
	[TEXT_MODEL_1_7B]: "text",
	[VISION_MODEL_2B]: "vision",
	[AUDIO_MODEL_2B]: "audio",
	[OMNI_MODEL_2B]: "omni",
};

export const MODEL_DESCRIPTION_BY_KEY: Record<ModelKey, string> = {
	[TEXT_MODEL_230M]: "Historical API rate only · not selectable in the Playground.",
	[TEXT_MODEL_1_7B]: "Everyday chat and reasoning. The default on paid plans.",
	[VISION_MODEL_2B]: "Image understanding. Included from Plus.",
	[AUDIO_MODEL_2B]: "Speech and audio input/output. Included from Max.",
	[OMNI_MODEL_2B]: "Text, image and audio in one model. Ultimate only.",
};

/**
 * The context levels the site works in.
 *
 * These are the steps of the ladder a customer can pick a context at: 16K, 32K,
 * 64K, 128K and 256K. LFM 3 models are served with 256K; LFM 2.5 230M keeps its
 * 128K window, so the UI must offer only the levels that model actually has.
 */
export const CONTEXT_LEVELS = [16384, 32768, 65536, 131072, 262144] as const;

/**
 * The context window each model is actually served with, in tokens.
 *
 * This is the llama.cpp router's own `ctx-size` per model, taken from
 * models/router-presets.ini -- the file the server is started with. It is not a
 * number the UI gets to choose: the server allocates the context, so a request
 * for more tokens than this is silently truncated by llama.cpp.
 *
 * `tests/model-context.test.ts` reads the ini file and fails if this table
 * drifts from it.
 */
export const MODEL_CONTEXT_TOKENS: Record<ModelKey, number> = {
	[TEXT_MODEL_230M]: 131072,
	[TEXT_MODEL_1_7B]: 262144,
	[VISION_MODEL_2B]: 262144,
	[AUDIO_MODEL_2B]: 262144,
	[OMNI_MODEL_2B]: 262144,
};

/** Context levels a particular model can actually serve. */
export function contextLevelsForModel(model: ModelKey): number[] {
	const maximum = MODEL_CONTEXT_TOKENS[model];
	return (CONTEXT_LEVELS as readonly number[]).filter((level) => level <= maximum);
}

/**
 * A context size as the site writes it: "16K", "32K", "64K", "128K", "256K".
 *
 * The ladder is what customers are sold, so it is how the site says it. A size
 * that is not a whole number of KiB is written out in full rather than rounded
 * to a level it does not sit on.
 */
export function formatContextTokens(tokens: number): string {
	if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}K`;
	return `${tokens}`;
}

/** Prompt/history/source budget, independent of the generated answer's length. */
export const DEFAULT_INPUT_CONTEXT_TOKENS = CONTEXT_LEVELS[0];
export const DEFAULT_OUTPUT_TOKENS = 2048;

/** Exported so the Playground can offer every model; each is priced individually. */
export const ALL_TEXT_MODEL_KEYS: TextModelKey[] = [TEXT_MODEL_230M, TEXT_MODEL_1_7B];
/** Text models customers may newly choose in the Playground; legacy keys stay known for history. */
export const PLAYGROUND_SELECTABLE_TEXT_MODEL_KEYS: TextModelKey[] = [TEXT_MODEL_1_7B];
const VISION_MODEL_KEYS: VisionModelKey[] = [VISION_MODEL_2B];
const AUDIO_MODEL_KEYS: AudioModelKey[] = [AUDIO_MODEL_2B];
const OMNI_MODEL_KEYS: OmniModelKey[] = [OMNI_MODEL_2B];
export const PLAYGROUND_MODEL_KEYS: ModelKey[] = [
	...ALL_TEXT_MODEL_KEYS,
	...VISION_MODEL_KEYS,
	...AUDIO_MODEL_KEYS,
	...OMNI_MODEL_KEYS,
];
/** Selectable models are distinct from known keys used to restore old transcripts and prices. */
export const PLAYGROUND_SELECTABLE_MODEL_KEYS: ModelKey[] = [
	...PLAYGROUND_SELECTABLE_TEXT_MODEL_KEYS,
	...VISION_MODEL_KEYS,
	...AUDIO_MODEL_KEYS,
	...OMNI_MODEL_KEYS,
];
const SELECTABLE_PLAYGROUND_MODEL_KEY_SET = new Set<string>(PLAYGROUND_SELECTABLE_MODEL_KEYS);
export function isPlaygroundModelKey(value: string): value is ModelKey {
	return PLAYGROUND_MODEL_KEYS.includes(value as ModelKey);
}
export function isSelectablePlaygroundModelKey(value: string): value is ModelKey {
	return SELECTABLE_PLAYGROUND_MODEL_KEY_SET.has(value);
}

const TEXT_MODEL_KEY_SET = new Set<string>(ALL_TEXT_MODEL_KEYS);
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
 * so the answer to "who gets Omni?" is readable without evaluating the code.
 *
 * LFM 2.5 230M is the Free plan's model and is not offered on paid plans.
 * LFM 3 1.7B is the default paid model, Vision joins at Plus, Audio at Max and
 * Omni is Ultimate only.
 */
export const MODEL_TIERS: Record<ModelKey, readonly UserSubscriptionTier[]> = {
	[TEXT_MODEL_230M]: ["free"],
	[TEXT_MODEL_1_7B]: ["basic", "plus", "pro", "max", "ultimate"],
	[VISION_MODEL_2B]: ["plus", "pro", "max", "ultimate"],
	[AUDIO_MODEL_2B]: ["max", "ultimate"],
	[OMNI_MODEL_2B]: ["ultimate"],
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
	return tierAllowsModel(tier, TEXT_MODEL_230M) ? TEXT_MODEL_230M : TEXT_MODEL_1_7B;
}

/** True when the tier may use a model that emits visible reasoning. */
export function tierCanUseThinkingModel(tier: UserSubscriptionTier): boolean {
	return tierAllowsModel(tier, TEXT_MODEL_1_7B);
}

/**
 * Which plans include which model.
 *
 * This used to be a quota table of prompts-per-month and the numbers are gone: usage is
 * metered in RON now (`nestjs-backend/src/billing/tier-allowance.ts`), so a prompt count
 * here would advertise a second, contradictory budget. Entitlement survives, because it is
 * the only thing stopping a free account from reaching the LFM 3 family.
 *
 * The backend enforces this matrix; this copy decides which models are *shown*. The two
 * are checked against each other by `nestjs-backend/test/model-limits.test.ts`, because a
 * model shown but refused is the bug that matters.
 */
export const MODEL_TIER_ACCESS: Record<ModelKey, Record<string, boolean>> = {
	[TEXT_MODEL_230M]: { free: true },
	[TEXT_MODEL_1_7B]: { basic: true, plus: true, pro: true, max: true, ultimate: true },
	[VISION_MODEL_2B]: { plus: true, pro: true, max: true, ultimate: true },
	[AUDIO_MODEL_2B]: { max: true, ultimate: true },
	[OMNI_MODEL_2B]: { ultimate: true },
};

/**
 * Emoji prefixes the marketing pages key their icons off.
 *
 * `SubscriptionPageContent` picks an icon by scanning the leading emoji and then
 * strips it before display, so these prefixes are load-bearing rather than
 * decoration. The vision/audio/omni prefixes must stay in its `getIcon` chain.
 */
const MODALITY_EMOJI: Record<ModelModality, string> = {
	text: "\u{1F9E0}",
	vision: "\u{1F4F7}",
	audio: "\u{1F3BC}",
	omni: "\u{2728}",
};

/** Model keys in the order a plan should advertise them (cheapest first). */
const MODEL_DISPLAY_ORDER: ModelKey[] = [
	TEXT_MODEL_230M,
	TEXT_MODEL_1_7B,
	VISION_MODEL_2B,
	AUDIO_MODEL_2B,
	OMNI_MODEL_2B,
];

/**
 * The models a plan includes, as benefit lines.
 *
 * No prompt count. The plan's included usage is a RON allowance that works across every
 * model, so appending a per-model prompt count to each line would advertise a
 * budget nothing enforces and contradict the allowance shown next to it.
 */
export function modelAccessLinesForTier(tier: UserSubscriptionTier): string[] {
	return MODEL_DISPLAY_ORDER.filter((key) => tierAllowsModel(tier, key)).map((key) => {
		const label = MODEL_LABEL_BY_KEY[key];
		return `${MODALITY_EMOJI[MODEL_MODALITY_BY_KEY[key]]} ${label}`;
	});
}

/** One-line summary of a plan's model access, for compact layouts. */
export function modelAccessSummaryForTier(tier: UserSubscriptionTier): string {
	const lines = modelAccessLinesForTier(tier);
	if (!lines.length) return "No models included on this plan.";
	return lines.map((line) => line.replace(/^\S+\s+/, "")).join(" · ");
}
