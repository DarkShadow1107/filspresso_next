import {
	MODEL_DESCRIPTION_BY_KEY,
	MODEL_LABEL_BY_KEY,
	MODEL_MODALITY_BY_KEY,
	MODEL_TIERS,
	allowedVisionModelsForTier,
	tierAllowsModel,
	tierCanUseThinkingModel,
	AUDIO_MODEL_1_5B,
	TEXT_MODEL_230M,
	TEXT_MODEL_350M,
	TEXT_MODEL_1_2B_INSTRUCT,
	TEXT_MODEL_1_2B_THINKING,
	TEXT_MODEL_2_6B,
	TEXT_MODEL_8B,
	VISION_MODEL_450M,
	VISION_MODEL_3B,
	type ModelKey,
	type UserSubscriptionTier,
} from "./modelAccess";

/** Conversations retained per plan; mirrors the backend's chat-history cap. */
const CHAT_MEMORY_LIMIT_BY_TIER: Record<string, number> = {
	none: 5,
	free: 5,
	basic: 20,
	plus: 50,
	pro: 100,
	max: 200,
	ultimate: 200,
};

/**
 * Tier gating for features that are not themselves models.
 *
 * This module exists because the playground gate had four independent
 * hand-written copies (`playground/chat/route.ts`, `PlaygroundContent.tsx`,
 * `CoffeeRecommender.tsx`, and a stale comment tying them together). They had
 * already drifted once: `hasLfmThinkingAccess` hardcoded `max || ultimate` while
 * the canonical table grants thinking to `pro`, so Pro users were denied a model
 * they were entitled to. Centralising first means the copy task cannot reintroduce
 * the same class of bug.
 *
 * Server-side routes MUST gate on these rather than on a client-supplied tier.
 */

/**
 * Plans that may send messages from the Spectre Playground.
 *
 * Tiers that bundle Playground access. The Spectre subscription grants the same access
 * independently, so this is a *sufficient* condition rather than the gate itself; the
 * authoritative answer comes from `resolveSpectreAccess` on the server. Enforced at
 * `api/playground/chat` and `api/playground/prewarm`. Note the gate is
 * about *sending*, not viewing: the page and its model lineup are public so a
 * prospective subscriber can see what exists.
 */
export const PLAYGROUND_MINIMUM_TIER: readonly UserSubscriptionTier[] = ["max", "ultimate"];

/**
 * What the Spectre subscription costs, and what it does not include.
 *
 * Kept beside the tier table because the plans page renders both and they must agree. The
 * backend serves the same figures from `/api/spectre/subscription`, which is the copy that
 * decides a charge -- this one exists for the components that render before any fetch
 * resolves.
 */
export const SPECTRE_SUBSCRIPTION = {
	monthlyRon: 99.99,
	annualRon: 1099.99,
	includesUsage: false,
} as const;

/** Plans whose vision uploads may be auto-converted and upscaled. */
export const AUTO_CONVERT_VISION_TIERS: readonly UserSubscriptionTier[] = [
	"pro",
	"max",
	"ultimate",
];

/** Minimum short-edge pixel count enforced on vision uploads. */
export const VISION_MIN_SHORT_EDGE_PX = 128;

/**
 * Normalise a tier that may arrive as a raw string.
 *
 * The server-side routes receive whatever the client or the DB produced, so
 * `pro`/`PRO`/`Pro` and `""` all have to resolve rather than throw.
 */
function normalize(tier: UserSubscriptionTier | string | null | undefined): string {
	return String(tier ?? "").trim().toLowerCase();
}

/** True when `tier` may use the Playground. */
export function tierCanUsePlayground(
	tier: UserSubscriptionTier | string | null | undefined,
): boolean {
	const value = normalize(tier);
	return (PLAYGROUND_MINIMUM_TIER as readonly string[]).includes(value);
}

/** True when `tier` may send Molecule Helper (chemistry) requests. */
export function tierCanUseMoleculeHelper(
	tier: UserSubscriptionTier | string | null | undefined,
): boolean {
	return normalize(tier) === "ultimate";
}

/** True when `tier` may edit a previously sent prompt. */
export function tierCanEditPrompt(
	tier: UserSubscriptionTier | string | null | undefined,
): boolean {
	const value = normalize(tier);
	return value === "max" || value === "ultimate";
}

/** True when `tier` may attach more than one image to a coffee prompt. */
export function tierCanUseMultiImagePrompt(
	tier: UserSubscriptionTier | string | null | undefined,
): boolean {
	return tierCanEditPrompt(tier);
}

/** Images allowed per prompt for `tier`. */
export function coffeeHelperImageLimitForTier(
	tier: UserSubscriptionTier | string | null | undefined,
): number {
	return tierCanUseMultiImagePrompt(tier) ? 3 : 1;
}

/** True when `tier` may send a vision upload at all. */
export function tierHasVisionAccess(
	tier: UserSubscriptionTier | string | null | undefined,
): boolean {
	return MODEL_TIERS[VISION_MODEL_450M].includes(normalize(tier) as UserSubscriptionTier);
}

/**
 * True when `tier` may auto-convert formats and upscale a vision upload.
 *
 * Deliberately an explicit list rather than derived from vision entitlement.
 * `modelAccess.ts` had a `tierCanAutoConvertVisionImage` that returned true for
 * anything with a VL model -- which includes Plus, since VL 450M starts there --
 * while both live call sites and the plans page said PRO. Deriving it was the bug;
 * this list is the single source of truth now.
 */
export function tierCanAutoConvertVisionImage(
	tier: UserSubscriptionTier | string | null | undefined,
): boolean {
	return (AUTO_CONVERT_VISION_TIERS as readonly string[]).includes(normalize(tier));
}

/** Formats a vision upload may use when auto-conversion is unavailable. */
export const DIRECT_UPLOAD_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/jpg"];
export const DIRECT_UPLOAD_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg"];

/** Formats accepted on any plan; non-converting tiers are then limited to the above. */
export const ALLOWED_VISION_UPLOAD_MIME_TYPES: readonly string[] = [
	"image/webp",
	"image/png",
	"image/avif",
	"image/tiff",
	"image/svg+xml",
	"image/jpeg",
	"image/jpg",
	"image/heic",
];
export const ALLOWED_VISION_UPLOAD_EXTENSIONS: readonly string[] = [
	"webp",
	"png",
	"avif",
	"tif",
	"tiff",
	"svg",
	"jpg",
	"jpeg",
	"heic",
];

/** True when the upload needs converting rather than being passed through. */
export function needsVisionAutoConvert(mime: string, extension: string): boolean {
	const directMime = DIRECT_UPLOAD_MIME_TYPES.includes(mime);
	const directExt = DIRECT_UPLOAD_EXTENSIONS.includes(extension);
	return !(directMime || directExt);
}

/** True when the upload is already a PNG/JPEG and may be used as-is. */
export function isDirectVisionUpload(mime: string, extension: string): boolean {
	return DIRECT_UPLOAD_MIME_TYPES.includes(mime) || DIRECT_UPLOAD_EXTENSIONS.includes(extension);
}

/**
 * Re-exported so call sites have one import for entitlement questions.
 *
 * `tierAllowsModel` and `tierCanUseThinkingModel` are canonical in `modelAccess`
 * and are deliberately not re-wrapped, only surfaced here.
 */
export { tierAllowsModel, tierCanUseThinkingModel };

// ---------------------------------------------------------------------------
// Marketing copy, derived rather than hand-written.
//
// The plans page used to carry its own list of model lines, and it drifted: it
// still advertised Gemma 3 (deleted) and promised vision on Basic, which the
// entitlement matrix does not grant. Every line below is computed from the
// predicate above it, so the page cannot claim something the API will refuse.
// ---------------------------------------------------------------------------

/** Emoji prefixes the plans page keys its icons off. */
const MODALITY_EMOJI: Record<string, string> = {
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

/** Models a plan includes, as ready-to-render benefit lines. */
export function modelAccessLinesForTier(tier: UserSubscriptionTier | string): string[] {
	const value = normalize(tier) as UserSubscriptionTier;
	// No per-model prompt count: the plan's included usage is a RON allowance that works
	// across every model, so a "120 prompts/month" suffix on each line would advertise a
	// budget nothing enforces.
	return MODEL_DISPLAY_ORDER.filter((key) => tierAllowsModel(value, key)).map((key) =>
		`${MODALITY_EMOJI[MODEL_MODALITY_BY_KEY[key]]} ${MODEL_LABEL_BY_KEY[key]}`,
	);
}

/** Feature (non-model) lines a plan includes, in display order. */
export function featureLinesForTier(tier: UserSubscriptionTier | string): string[] {
	const value = normalize(tier) as UserSubscriptionTier;
	const lines: string[] = [];

	if (tierCanUsePlayground(value)) {
		// The text-modality icon, so this reads the same as the MiniLM line rather than
		// carrying its own glyph. It used to be a clapper board, which was the only
		// benefit line with an icon unrelated to what the feature actually is.
		lines.push(`${MODALITY_EMOJI.text} Spectre Playground included (or subscribe separately)`);
	}
	if (tierCanUseMoleculeHelper(value)) {
		lines.push("\u{1F9EC} Molecule Helper (LFM 2.5 VL)");
	}
	if (tierCanEditPrompt(value)) {
		lines.push("\u{270F}\u{FE0F} Edit prompt feature");
	}
	if (tierCanAutoConvertVisionImage(value)) {
		lines.push(
			"\u{1F4F7} Auto-convert image formats to JPG + auto-upscale (min 128px)",
		);
	}
	if (tierCanUseMultiImagePrompt(value)) {
		lines.push("\u{1F4F7} Coffee Helper - up to 3 images per prompt");
	} else if (tierHasVisionAccess(value)) {
		lines.push("\u{1F4F7} Coffee Helper - 1 image per prompt (PNG/JPG, min 128px)");
	}
	return lines;
}

/** Retention allowance for a plan, for the memory line. */
export function chatMemoryLimitForTier(tier: UserSubscriptionTier | string): number {
	const value = normalize(tier) as UserSubscriptionTier;
	return CHAT_MEMORY_LIMIT_BY_TIER[value] ?? CHAT_MEMORY_LIMIT_BY_TIER.none;
}