import {
	allowedVisionModelsForTier,
	tierAllowsModel,
	tierCanUseThinkingModel,
	type UserSubscriptionTier,
} from "./modelAccess";

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
 * Plans that may send messages from the Model Playground.
 *
 * Enforced at `api/playground/chat` and `api/playground/prewarm`. Note the gate is
 * about *sending*, not viewing: the page and its model lineup are public so a
 * prospective subscriber can see what exists.
 */
export const PLAYGROUND_MINIMUM_TIER: readonly UserSubscriptionTier[] = ["max", "ultimate"];

/** Plans whose vision uploads may be auto-converted and upscaled. */
export const AUTO_CONVERT_VISION_TIERS: readonly UserSubscriptionTier[] = [
	"pro",
	"max",
	"ultimate",
];

/** Minimum short-edge pixel count enforced on vision uploads. */
export const VISION_MIN_SHORT_EDGE_PX = 128;

/** True when `tier` may use the Playground. */
export function tierCanUsePlayground(tier: UserSubscriptionTier | null | undefined): boolean {
	if (!tier) return false;
	return PLAYGROUND_MINIMUM_TIER.includes(tier);
}

/** True when `tier` may send Molecule Helper (chemistry) requests. */
export function tierCanUseMoleculeHelper(tier: UserSubscriptionTier | null | undefined): boolean {
	return tier === "ultimate";
}

/** True when `tier` may edit a previously sent prompt. */
export function tierCanEditPrompt(tier: UserSubscriptionTier | null | undefined): boolean {
	return tier === "max" || tier === "ultimate";
}

/** True when `tier` may attach more than one image to a coffee prompt. */
export function tierCanUseMultiImagePrompt(tier: UserSubscriptionTier | null | undefined): boolean {
	return tier === "max" || tier === "ultimate";
}

/** Images allowed per prompt for `tier`. */
export function coffeeHelperImageLimitForTier(tier: UserSubscriptionTier | null | undefined): number {
	return tierCanUseMultiImagePrompt(tier) ? 3 : 1;
}

/** True when `tier` may send a vision upload at all. */
export function tierHasVisionAccess(tier: UserSubscriptionTier | null | undefined): boolean {
	if (!tier) return false;
	return allowedVisionModelsForTier(tier).length > 0;
}

/**
 * Re-exported so call sites have one import for entitlement questions.
 *
 * `tierAllowsModel` and `tierCanUseThinkingModel` are canonical in `modelAccess`
 * and are deliberately not re-wrapped, only surfaced here.
 */
export { tierAllowsModel, tierCanUseThinkingModel };