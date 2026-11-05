"use client";

import WorkspaceIcon from "./WorkspaceIcon";
import type { SavedToolActivity } from "@/lib/playgroundSessions";

/** React adaptation of llama.cpp's MIT-licensed CollapsibleContentBlock and
 * ChatMessageAgenticContent (ggml-org/llama.cpp, 25eec6f32). The native Svelte
 * components cannot be mounted directly in the Next/React tree. */
export default function LlamaToolActivity({ tool }: { tool: SavedToolActivity }) {
	const name = tool.name === "research_web" ? "Web Search & Read" : tool.name.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
	let args = tool.arguments;
	try { args = JSON.stringify(JSON.parse(args), null, 2); } catch { /* Preserve the original inert text. */ }
	let result = tool.result;
	if (result) {
		const split = result.indexOf("\n");
		if (split >= 0) {
			try { result = `${result.slice(0, split)}\n${JSON.stringify(JSON.parse(result.slice(split + 1)), null, 2)}`; } catch { /* Non-JSON output remains unchanged. */ }
		}
	}
	return <details className="pgw-tool-activity">
		<summary><span className="pgw-tool-title"><WorkspaceIcon name={tool.name.includes("web") || tool.name === "fetch_page" ? "search" : "settings"} width={16} /><strong>{name}</strong><em>{tool.status === "finished" ? "Finished" : "Pending"}</em></span><span className="pgw-tool-chevron" aria-hidden="true">⌄</span></summary>
		<div className="pgw-tool-content"><p>Input</p><pre>{args}</pre>{result && <><p>Output</p><pre>{result}</pre></>}</div>
	</details>;
}
