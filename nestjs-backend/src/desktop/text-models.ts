/**
 * The text models the Spectre Playground offers.
 *
 * Why the backend keeps its own copy. `MODEL_TOKEN_PRICING` prices all nine served models:
 * six text, two vision, one audio. The Playground -- web and desktop alike -- exposes only
 * the text six, because the other three have no surface in it. The authoritative modality
 * map lives in the frontend (`src/lib/modelAccess.ts`), which this package cannot import, so
 * the list is restated here.
 *
 * Restated lists drift. That is not a risk accepted here, it is a risk that fails a test:
 * `desktop-catalogue.test.ts` reads the frontend source and asserts this set matches
 * `TEXT_MODEL_KEYS` exactly. Adding a model to one side without the other breaks the build,
 * not a customer's session.
 *
 * Deriving the set from the pricing table's key names -- "everything without `vl_` or
 * `audio_`" -- was the alternative and was rejected: it makes a naming convention load
 * bearing. Renaming a model would silently change which models the product sells.
 */
export const PLAYGROUND_TEXT_MODEL_KEYS: readonly string[] = [
	"lfm2_5_230m_q4_k_m",
	"lfm2_5_350m_q8_0",
	"lfm2_5_1_2b_instruct_q4_k_m",
	"lfm2_5_1_2b_thinking_q4_k_m",
	"lfm2_5_2_6b_q4_0",
	"lfm2_5_8b_a1b_q4_k_m",
] as const;

/** Cheapest first, so the catalogue reads as a ladder the way the web line-up does. */
export function playgroundTextModelKeys(): string[] {
	return [...PLAYGROUND_TEXT_MODEL_KEYS];
}

export function isPlaygroundTextModel(modelKey: string): boolean {
	return PLAYGROUND_TEXT_MODEL_KEYS.includes(modelKey);
}

/**
 * Model key to GGUF filename, as the AI service expects it on `/api/chat/stream`.
 *
 * The same drift problem as the list above, and guarded by the same test, which asserts this
 * mapping agrees with `MODEL_FILE_BY_KEY` in the frontend. The gateway cannot ask the AI
 * service to resolve a key: that endpoint takes a filename, and inventing the conversion
 * from the key's name pattern would make a rename silently unload the wrong weights.
 */
export const PLAYGROUND_TEXT_MODEL_FILES: Readonly<Record<string, string>> = {
	lfm2_5_230m_q4_k_m: "LFM2.5-230M-Q4_K_M.gguf",
	lfm2_5_350m_q8_0: "LFM2.5-350M-Q8_0.gguf",
	lfm2_5_1_2b_instruct_q4_k_m: "LFM2.5-1.2B-Instruct-Q4_K_M.gguf",
	lfm2_5_1_2b_thinking_q4_k_m: "LFM2.5-1.2B-Thinking-Q4_K_M.gguf",
	lfm2_5_2_6b_q4_0: "LFM2.5-2.6B-Q4_0.gguf",
	lfm2_5_8b_a1b_q4_k_m: "LFM2.5-8B-A1B-Q4_K_M.gguf",
};

/** The GGUF filename for a model key, or null when the key is not a Playground model. */
export function playgroundModelFile(modelKey: string): string | null {
	if (!isPlaygroundTextModel(modelKey)) return null;
	return PLAYGROUND_TEXT_MODEL_FILES[modelKey] ?? null;
}
