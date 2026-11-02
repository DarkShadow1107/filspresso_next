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
	return <details className="pgw-tool-activity">
		<summary><span className="pgw-tool-title"><WorkspaceIcon name={tool.name.includes("web") || tool.name === "fetch_page" ? "search" : "settings"} width={16} /><strong>{name}</strong>{tool.status !== "finished" && <em>pending</em>}</span><span className="pgw-tool-chevron" aria-hidden="true">⌃<br />⌄</span></summary>
		<div className="pgw-tool-content"><p>Arguments:</p><pre>{args}</pre>{tool.result && <><p>Result:</p><pre>{tool.result}</pre></>}</div>
	</details>;
}
