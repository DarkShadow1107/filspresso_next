export const INPUT_CONTEXT_LEVELS = [16_384, 32_768, 65_536, 131_072] as const;

/** Input context is independent of the generation's max_tokens/output budget. */
export function readInputContext(body: Record<string, unknown>): Record<string, unknown> {
	const input = Number(body.input_context_tokens ?? body.inputContextTokens ?? INPUT_CONTEXT_LEVELS[0]);
	if (!(INPUT_CONTEXT_LEVELS as readonly number[]).includes(input)) throw new Error("Choose a 16K, 32K, 64K or 128K input context.");
	if (body.web_research !== undefined && ![true, false, "true", "false"].includes(body.web_research as boolean | string)) {
		throw new Error("Internet access must be on or off.");
	}
	const history = body.history ?? [];
	const contexts = body.contexts ?? [];
	if (!Array.isArray(history) || history.length > 100 || !Array.isArray(contexts) || contexts.length > 12) throw new Error("There are too many messages or sources in this request.");
	let size = 0;
	for (const turn of history) {
		if (!turn || typeof turn !== "object" || !["user", "assistant"].includes(turn.role) || typeof turn.content !== "string") throw new Error("Invalid conversation history.");
		size += turn.content.length;
	}
	for (const item of contexts) {
		if (!item || typeof item !== "object" || typeof item.text !== "string" || item.text.length > 240_000 || typeof item.name !== "string") throw new Error("Invalid attachment context.");
		size += item.text.length;
	}
	if (size > 780_000) throw new Error("This conversation contains too much text. Remove some sources or start a new conversation.");
	const mode = body.compaction_mode ?? body.compactionMode ?? "balanced";
	if (typeof mode !== "string" || !["permissive", "balanced", "aggressive"].includes(mode)) throw new Error("Choose Permissive, Balanced or Aggressive compaction.");
	return { input_context_tokens: input, history, contexts, compaction_mode: mode, compact_now: body.compact_now === true };
}
