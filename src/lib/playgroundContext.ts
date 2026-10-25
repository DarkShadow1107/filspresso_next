export type CompactionMode = "permissive" | "balanced" | "aggressive";
export const COMPACTION_OPTIONS = [
	{ key: "permissive", label: "Permissive · 80%", threshold: 0.8 },
	{ key: "balanced", label: "Balanced · 65% (default)", threshold: 0.65 },
	{ key: "aggressive", label: "Aggressive · 45%", threshold: 0.45 },
] as const;
export function compactionMode(value: unknown): CompactionMode {
	return value === "permissive" || value === "aggressive" ? value : "balanced";
}
export type ContextState = {
	mode: CompactionMode;
	inputLimit: number;
	tokensBefore: number;
	tokensAfter: number;
	compacted: boolean;
	summary?: string;
	notice?: string;
	history?: Array<{ role: "user" | "assistant"; content: string }>;
	usage?: { prompt_tokens: number; completion_tokens: number } | null;
};
