/**
 * The Playground's explicitly mapped models: two text, two Vision/Audio and one Omni.
 * The text subset is retained for modality-specific callers; the full catalogue supports
 * media-import recommendations. Tests check every GGUF mapping against the frontend table.
 */
export const PLAYGROUND_TEXT_MODEL_KEYS: readonly string[] = [
	"lfm2_5_230m_q4_k_m",
	"lfm3_1_7b_q4_k_m",
] as const;

/** Cheapest first, so the catalogue reads as a ladder the way the web line-up does. */
export function playgroundTextModelKeys(): string[] {
	return [...PLAYGROUND_TEXT_MODEL_KEYS];
}

export function isPlaygroundTextModel(modelKey: string): boolean {
	return PLAYGROUND_TEXT_MODEL_KEYS.includes(modelKey);
}

export const PLAYGROUND_MEDIA_MODEL_FILES: Readonly<Record<string, string>> = {
	lfm3_vl_2b_q4_k_m: "LFM3-VL-2B-Q4_K_M.gguf",
	lfm3_audio_2b_q4_k_m: "LFM3-Audio-2B-Q4_K_M.gguf",
	lfm3_omni_2b_q4_k_m: "LFM3-Omni-2B-Q4_K_M.gguf",
};

/** Text, Vision-Language, Audio and Omni are selectable when working with imported media. */
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
	lfm3_1_7b_q4_k_m: "LFM3-1.7B-Q4_K_M.gguf",
};

/** The GGUF filename for a model key, or null when the key is not a Playground model. */
export function playgroundModelFile(modelKey: string): string | null {
	if (isPlaygroundTextModel(modelKey)) return PLAYGROUND_TEXT_MODEL_FILES[modelKey] ?? null;
	return Object.prototype.hasOwnProperty.call(PLAYGROUND_MEDIA_MODEL_FILES, modelKey) ? PLAYGROUND_MEDIA_MODEL_FILES[modelKey] : null;
}
