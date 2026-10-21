"use client";

import { Fragment, useState } from "react";
import WorkspaceIcon from "./WorkspaceIcon";

function inline(text: string) {
	return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
		if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
		if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
		return <Fragment key={index}>{part}</Fragment>;
	});
}

function CodeBlock({ language, code }: { language: string; code: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="pgw-code">
			<div className="pgw-code-heading">
				<span>{language || "Code"}</span>
				<button type="button" onClick={async () => {
					try {
						await navigator.clipboard.writeText(code);
						setCopied(true);
						window.setTimeout(() => setCopied(false), 2000);
					} catch { setCopied(false); }
				}}><WorkspaceIcon name={copied ? "check" : "copy"} width={14} height={14} /> {copied ? "Copied" : "Copy code"}</button>
			</div>
			<pre><code>{code}</code></pre>
		</div>
	);
}

/** Render model text as React nodes: model-produced HTML is never executed. */
export default function PlaygroundMessageContent({ text }: { text: string }) {
	const parts = text.split(/```([^\n`]*)\n([\s\S]*?)(?:```|$)/g);
	return <div className="pgw-message-text">{parts.map((part, index) => {
		if (index % 3 === 1) return null;
		if (index % 3 === 2) return <CodeBlock key={index} language={parts[index - 1].trim()} code={part.replace(/\n$/, "")} />;
		return part.split(/\n\s*\n/).filter(Boolean).map((paragraph, p) => {
			const heading = paragraph.match(/^(#{1,3})\s+(.+)$/);
			if (heading) return <h3 key={`${index}-${p}`}>{inline(heading[2])}</h3>;
			const lines = paragraph.split("\n");
			if (lines.every((line) => /^\s*[-*]\s+/.test(line))) return <ul key={`${index}-${p}`}>{lines.map((line, l) => <li key={l}>{inline(line.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>;
			if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) return <ol key={`${index}-${p}`}>{lines.map((line, l) => <li key={l}>{inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>)}</ol>;
			return <p key={`${index}-${p}`}>{inline(paragraph)}</p>;
		});
	})}</div>;
}
