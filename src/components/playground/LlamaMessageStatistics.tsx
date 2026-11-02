"use client";

import { useState } from "react";
import WorkspaceIcon from "./WorkspaceIcon";

/** Adapted from llama.cpp ChatMessageStatistics (MIT, 25eec6f32). Response time
 * here is wall time, not llama.cpp's unavailable per-token generation timing. */
export default function LlamaMessageStatistics({ model, inputTokens, outputTokens, seconds }: { model: string; inputTokens?: number; outputTokens?: number; seconds?: number }) {
	const [view, setView] = useState<"input" | "output">("output");
	const count = view === "input" ? inputTokens : outputTokens;
	return <div className="pgw-message-meta">
		<span className="pgw-model-badge"><WorkspaceIcon name="model" width={14} /> {model}</span>
		<span className="pgw-stats-switch" aria-label="Token statistics">
			<button type="button" aria-label="Prompt tokens" aria-pressed={view === "input"} onClick={() => setView("input")}>▤</button>
			<button type="button" aria-label="Generated tokens" aria-pressed={view === "output"} onClick={() => setView("output")}>✧</button>
		</span>
		{count !== undefined && <span title={view === "input" ? "Prompt tokens from the last model turn" : "Generated tokens"}>▱ {count.toLocaleString()} tokens</span>}
		{seconds !== undefined && <span title="Elapsed response time, including tools and approvals">◷ {seconds.toFixed(1)}s</span>}
		{view === "output" && outputTokens !== undefined && seconds !== undefined && seconds > 0 && <span title="Average over elapsed response time, not model decoding speed">◴ {(outputTokens / seconds).toFixed(2)} t/s</span>}
	</div>;
}
