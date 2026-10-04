import test from "node:test";
import assert from "node:assert/strict";

import {
	AUTO_CONVERT_VISION_TIERS,
	PLAYGROUND_MINIMUM_TIER,
	VISION_MIN_SHORT_EDGE_PX,
	ALLOWED_VISION_UPLOAD_EXTENSIONS,
	ALLOWED_VISION_UPLOAD_MIME_TYPES,
	DIRECT_UPLOAD_EXTENSIONS,
	DIRECT_UPLOAD_MIME_TYPES,
	chatMemoryLimitForTier,
	coffeeHelperImageLimitForTier,
	featureLinesForTier,
	isDirectVisionUpload,
	modelAccessLinesForTier,
	needsVisionAutoConvert,
	tierCanAutoConvertVisionImage,
	tierCanEditPrompt,
	tierCanUseMoleculeHelper,
	tierCanUseMultiImagePrompt,
	tierCanUsePlayground,
	tierHasVisionAccess,
} from "../src/lib/entitlements";
import {
	MODEL_LABEL_BY_KEY,
	MODEL_TIERS,
	allowedTextModelsForTier,
	allowedVisionModelsForTier,
	tierAllowsModel,
	tierCanUseThinkingModel,
	monthlyLimitForModelTier,
	type ModelKey,
	type UserSubscriptionTier,
} from "../src/lib/modelAccess";

const TIERS: UserSubscriptionTier[] = [
	"none",
	"free",
	"basic",
	"plus",
	"pro",
	"max",
	"ultimate",
];

test("every model a plan advertises is one the plan is entitled to", () => {
	for (const tier of TIERS) {
		for (const line of modelAccessLinesForTier(tier)) {
			const label = line.replace(/^\S+\s+/, "").split(" - ")[0];
			const key = (Object.keys(MODEL_LABEL_BY_KEY) as ModelKey[]).find(
				(k) => MODEL_LABEL_BY_KEY[k] === label,
			);
			assert.ok(key, `no model key for advertised label ${label}`);
			assert.ok(
				tierAllowsModel(tier, key),
				`${tier} advertises ${label} but is not entitled to it`,
			);
		}
	}
});

test("every entitled model is advertised (no silent omission)", () => {
	for (const tier of TIERS) {
		const lines = modelAccessLinesForTier(tier);
		for (const key of allowedTextModelsForTier(tier)) {
			assert.ok(
				lines.some((l) => l.includes(MODEL_LABEL_BY_KEY[key])),
				`${tier} is entitled to ${MODEL_LABEL_BY_KEY[key]} but it is not advertised`,
			);
		}
		for (const key of allowedVisionModelsForTier(tier)) {
			assert.ok(
				lines.some((l) => l.includes(MODEL_LABEL_BY_KEY[key])),
				`${tier} is entitled to ${MODEL_LABEL_BY_KEY[key]} but it is not advertised`,
			);
		}
	}
});

test("every advertised model line carries a real allowance", () => {
	for (const tier of TIERS) {
		for (const line of modelAccessLinesForTier(tier)) {
			// Strip the leading modality emoji the plans page keys its icons off.
			const match = /^(.*) - (\d+) prompts\/month$/.exec(line.replace(/^\S+\s+/, ""));
			assert.ok(match, `${tier}: "${line}" has no allowance`);
			const key = (Object.keys(MODEL_LABEL_BY_KEY) as ModelKey[]).find(
				(k) => MODEL_LABEL_BY_KEY[k] === match[1],
			);
			assert.ok(key, `${tier}: no model key for parsed label ${JSON.stringify(match[1])}`);
			assert.equal(
				Number(match[2]),
				monthlyLimitForModelTier(tier, key),
				`${tier}/${key} advertises ${match[2]} but the allowance is ${monthlyLimitForModelTier(tier, key)}`,
			);
		}
	}
});

test("feature lines never claim something the predicates deny", () => {
	for (const tier of TIERS) {
		const lines = featureLinesForTier(tier).join(" | ");
		if (lines.includes("Model Playground")) {
			assert.ok(tierCanUsePlayground(tier), `${tier} advertises the Playground without access`);
		}
		if (lines.includes("Molecule Helper")) {
			assert.ok(tierCanUseMoleculeHelper(tier), `${tier} advertises Molecule Helper`);
		}
		if (lines.includes("Edit prompt")) {
			assert.ok(tierCanEditPrompt(tier), `${tier} advertises edit prompt`);
		}
		if (lines.includes("Auto-convert")) {
			assert.ok(
				tierCanAutoConvertVisionImage(tier),
				`${tier} advertises auto-convert without it`,
			);
		}
		if (lines.includes("3 images")) {
			assert.ok(tierCanUseMultiImagePrompt(tier), `${tier} advertises 3 images`);
		}
		if (lines.includes("1 image")) {
			assert.ok(!tierCanUseMultiImagePrompt(tier), `${tier} advertises 1 image but allows 3`);
		}
	}
});

test("the Playground is a MAX/ULTIMATE feature and is advertised exactly there", () => {
	// This is the copy the plans page was missing entirely.
	assert.deepEqual([...PLAYGROUND_MINIMUM_TIER], ["max", "ultimate"]);
	for (const tier of TIERS) {
		const advertised = featureLinesForTier(tier).some((l) => l.includes("Model Playground"));
		assert.equal(
			advertised,
			PLAYGROUND_MINIMUM_TIER.includes(tier),
			`${tier}: advertised=${advertised} entitled=${PLAYGROUND_MINIMUM_TIER.includes(tier)}`,
		);
	}
});

test("auto-convert is PRO+, not derived from vision entitlement", () => {
	// Regression guard. `modelAccess.ts` had a version that returned true for
	// anything with a VL model, which includes Plus. Both live call sites and the
	// plans page said PRO.
	assert.deepEqual([...AUTO_CONVERT_VISION_TIERS], ["pro", "max", "ultimate"]);
	assert.equal(tierCanAutoConvertVisionImage("plus"), false);
	assert.equal(tierCanAutoConvertVisionImage("pro"), true);
	// Plus does have a vision model, which is exactly why deriving was wrong.
	assert.equal(tierHasVisionAccess("plus"), true);
});

test("Molecule Helper is ULTIMATE-only in the copy", () => {
	for (const tier of TIERS) {
		assert.equal(
			featureLinesForTier(tier).some((l) => l.includes("Molecule Helper")),
			tier === "ultimate",
			tier,
		);
	}
});

test("image allowances are monotonic in the tier", () => {
	assert.equal(coffeeHelperImageLimitForTier("free"), 1);
	assert.equal(coffeeHelperImageLimitForTier("pro"), 1);
	assert.equal(coffeeHelperImageLimitForTier("max"), 3);
	assert.equal(coffeeHelperImageLimitForTier("ultimate"), 3);
});

test("the vision minimum matches the documented 128px", () => {
	assert.equal(VISION_MIN_SHORT_EDGE_PX, 128);
});

test("direct uploads are a strict subset of allowed uploads", () => {
	for (const mime of DIRECT_UPLOAD_MIME_TYPES) {
		assert.ok(
			ALLOWED_VISION_UPLOAD_MIME_TYPES.includes(mime),
			`${mime} is direct but not allowed`,
		);
	}
	for (const ext of DIRECT_UPLOAD_EXTENSIONS) {
		assert.ok(
			ALLOWED_VISION_UPLOAD_EXTENSIONS.includes(ext),
			`.${ext} is direct but not allowed`,
		);
	}
	assert.equal(isDirectVisionUpload("image/png", "png"), true);
	assert.equal(isDirectVisionUpload("image/webp", "webp"), false);
	assert.equal(needsVisionAutoConvert("image/webp", "webp"), true);
	assert.equal(needsVisionAutoConvert("image/jpeg", "jpg"), false);
});

test("thinking is PRO+ per the canonical model table", () => {
	for (const tier of TIERS) {
		assert.equal(tierCanUseThinkingModel(tier), tierAllowsModel(tier, "lfm2_5_1_2b_thinking_q4_k_m"), tier);
	}
	// The hand-rolled check this replaced hardcoded max||ultimate and denied Pro.
	assert.equal(tierCanUseThinkingModel("pro"), true);
});

test("chat memory allowances are defined for every tier", () => {
	for (const tier of TIERS) {
		assert.ok(chatMemoryLimitForTier(tier) >= 5, tier);
	}
	assert.ok(chatMemoryLimitForTier("ultimate") > chatMemoryLimitForTier("free"));
});

test("tier predicates tolerate the raw strings a server route receives", () => {
	// Server routes hand us whatever the client or DB produced.
	for (const raw of ["ULTIMATE", " ultimate ", "Ultimate"]) {
		assert.equal(tierCanUsePlayground(raw), true, raw);
		assert.equal(tierCanUseMoleculeHelper(raw), true, raw);
	}
	assert.equal(tierCanUsePlayground(""), false);
	assert.equal(tierCanUsePlayground(null), false);
	assert.equal(tierCanUsePlayground(undefined), false);
});

test("MODEL_TIERS and the feature predicates agree on vision", () => {
	for (const tier of TIERS) {
		const derived = MODEL_TIERS["lfm2_5_vl_450m_q4_k_m"].includes(tier);
		assert.equal(tierHasVisionAccess(tier), derived, tier);
	}
});