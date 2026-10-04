export const PRUNE_MINIMUM = 20_000;
export const PRUNE_PROTECT = 40_000;
const TOOL_OUTPUT_MAX_CHARS = 2_000;
const MIN_PRESERVE_RECENT_TOKENS = 2_000;
const MAX_PRESERVE_RECENT_TOKENS = 15_000;

export type CompactionMode = "off" | "balanced" | "proactive" | "aggressive";

const THRESHOLDS: Record<Exclude<CompactionMode, "off">, number> = {
	balanced: 0.8,
	proactive: 0.65,
	aggressive: 0.5
};

export type ChatMessage = {
	role: string;
	content?: unknown;
	[key: string]: unknown;
};

export type CompactResult = {
	messages: ChatMessage[];
	compacted: boolean;
	prunedTokens: number;
};

const truncate = (value: string) =>
	value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`;

function contentText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value == null) return '';
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function estimateTokens(text: unknown): number {
	return Math.ceil(contentText(text).length / 4);
}

function preserveRecentBudget(contextTokens: number): number {
	return Math.min(
		MAX_PRESERVE_RECENT_TOKENS,
		Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(contextTokens * 0.25))
	);
}

function hasStructuredFields(message: ChatMessage): boolean {
	return (
		message.role === 'tool' ||
		message.role === 'function' ||
		message.tool_call_id != null ||
		message.tool_calls != null ||
		message.function_call != null ||
		message.reasoning_content != null ||
		message.thinking != null
	);
}

function serializeTurn(message: ChatMessage): string {
	const roleLabel = {
		assistant: 'Assistant',
		system: 'System',
		tool: 'Tool',
		function: 'Function',
		user: 'User'
	}[message.role] ?? message.role;
	const body = truncate(contentText(message.content).trim());
	const structured: Record<string, unknown> = {};
	for (const key of [
		'name',
		'tool_call_id',
		'tool_calls',
		'function_call',
		'reasoning_content',
		'thinking'
	]) {
		if (message[key] != null) structured[key] = message[key];
	}
	const metadata = hasStructuredFields(message)
		? `\n[structured]: ${truncate(contentText(structured))}`
		: '';
	return body || metadata ? `[${roleLabel}]: ${body}${metadata}` : '';
}

function prune(messages: ChatMessage[], turnsToProtect = 2): { messages: ChatMessage[]; prunedTokens: number } {
	let protectedRemaining = turnsToProtect;
	let total = 0;
	let pruned = 0;
	let sawContent = false;

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role === 'user') {
			if (!sawContent) continue;
			protectedRemaining -= 1;
			if (protectedRemaining <= 0) break;
			continue;
		}
		sawContent = true;
		if (message.role !== 'assistant' || hasStructuredFields(message)) continue;
		const size = estimateTokens(message.content);
		if (size <= TOOL_OUTPUT_MAX_CHARS / 4) continue;
		total += size;
		if (total <= PRUNE_PROTECT) continue;
		pruned += size;
		message.content = `${contentText(message.content).slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[Older output cleared]`;
	}

	return { messages, prunedTokens: pruned > PRUNE_MINIMUM ? pruned : 0 };
}

export function compactMessages(
	messages: ChatMessage[],
	options: { contextTokens: number; mode: CompactionMode }
): CompactResult {
	if (options.mode === 'off' || messages.length === 0) {
		return { messages, compacted: false, prunedTokens: 0 };
	}

	const prunedResult = prune([...messages.map((m) => ({ ...m }))]);
	let working = prunedResult.messages;

	const threshold = THRESHOLDS[options.mode];
	const budgetTokens = Math.floor(options.contextTokens * threshold);
	const totalTokens = working.reduce((sum, m) => sum + estimateTokens(m.content), 0);

	if (totalTokens <= budgetTokens) {
		return { messages: working, compacted: false, prunedTokens: prunedResult.prunedTokens };
	}

	const tailBudget = preserveRecentBudget(options.contextTokens);
	let acc = 0;
	let cut = 1;
	for (let index = working.length - 1; index > 0; index--) {
		acc += estimateTokens(working[index].content);
		if (acc > tailBudget) {
			cut = index + 1;
			break;
		}
		cut = index;
	}
	// Keep the latest user turn together with any assistant tool call and tool result that follow it.
	const safeCut = working
		.slice(0, cut + 1)
		.map((message, index) => (message.role === 'user' ? index : -1))
		.filter((index) => index > 0)
		.at(-1);
	if (safeCut !== undefined) cut = safeCut;
	if (cut <= 0) {
		return { messages: working, compacted: false, prunedTokens: prunedResult.prunedTokens };
	}

	const head = working.slice(0, cut);
	const tail = working.slice(cut);
	const transcript = head.map(serializeTurn).filter(Boolean).join('\n\n');
	const summary: ChatMessage = {
		role: 'system',
		content: `[Context compacted ${new Date().toISOString()}]\nEarlier conversation transcript:\n${transcript}`
	};

	return {
		messages: [summary, ...tail],
		compacted: true,
		prunedTokens: prunedResult.prunedTokens
	};
}
