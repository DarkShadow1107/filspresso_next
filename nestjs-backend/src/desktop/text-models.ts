/**
 * The Playground's explicitly mapped models: six text, two Vision-Language, one Audio.
 * The text subset is retained for modality-specific callers; the full catalogue supports
 * media-import recommendations. Tests check every GGUF mapping against the frontend table.
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

export const PLAYGROUND_MEDIA_MODEL_FILES: Readonly<Record<string, string>> = {
	lfm2_5_vl_450m_q4_k_m: "LFM2.5-VL-450M-Q4_K_M.gguf",
	lfm2_5_vl_3b_q4_k_m: "LFM2.5-VL-3B-Q4_K_M.gguf",
	lfm2_5_audio_1_5b_q4_0: "LFM2.5-Audio-1.5B-Q4_0.gguf",
};

/** Text, Vision-Language and Audio are selectable when working with imported media. */
export function playgroundModelKeys(): string[] {
	return [...PLAYGROUND_TEXT_MODEL_KEYS, ...Object.keys(PLAYGROUND_MEDIA_MODEL_FILES)];
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
	if (isPlaygroundTextModel(modelKey)) return PLAYGROUND_TEXT_MODEL_FILES[modelKey] ?? null;
	return Object.prototype.hasOwnProperty.call(PLAYGROUND_MEDIA_MODEL_FILES, modelKey) ? PLAYGROUND_MEDIA_MODEL_FILES[modelKey] : null;
}
