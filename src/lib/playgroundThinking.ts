/** Requested reasoning-token ceiling. A model may ignore or not support it. */
export type ThinkingLevel = "off" | "default" | "low" | "medium" | "high";
export const THINKING_OPTIONS = [
	{ key: "default", label: "Default · Medium" },
	{ key: "low", label: "Low" },
	{ key: "medium", label: "Medium" },
	{ key: "high", label: "High" },
	{ key: "off", label: "Off" },
] as const;
export function thinkingLevel(value: unknown): ThinkingLevel {
	return value === "off" || value === "low" || value === "medium" || value === "high" ? value : "default";
}
