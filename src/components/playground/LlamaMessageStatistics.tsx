"use client";

import { useState } from "react";
import WorkspaceIcon from "./WorkspaceIcon";

/* The same Lucide icons used by llama.cpp's ChatMessageStatistics.
 * Copyright (c) 2026 Lucide Icons and Contributors. ISC License:
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT,
 * OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
 * DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS
 * ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 * The clock icon is also derived from Feather:
 * Copyright (c) 2013-present Cole Bemis. MIT License. Permission is hereby granted,
 * free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons
 * to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
function StatIcon({ name }: { name: "book" | "sparkles" | "word" | "clock" | "gauge" }) {
	return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		{name === "book" ? <><path d="M12 5v16M16 13h2M16 9h2M6 13h2M6 9h2" /><path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z" /></> :
		name === "sparkles" ? <><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4M22 4h-4" /><circle cx="4" cy="20" r="2" /></> :
		name === "word" ? <><circle cx="7" cy="12" r="3" /><path d="M10 9v6M14 7v8M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" /><circle cx="17" cy="12" r="3" /></> :
		name === "clock" ? <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></> : <><path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0" /></>}
	</svg>;
}

/** Adapted from llama.cpp ChatMessageStatistics (MIT, 25eec6f32). Response time
 * here is wall time, not llama.cpp's unavailable per-token generation timing. */
export default function LlamaMessageStatistics({ model, inputTokens, outputTokens, seconds }: { model: string; inputTokens?: number; outputTokens?: number; seconds?: number }) {
	const [view, setView] = useState<"input" | "output">("output");
	const count = view === "input" ? inputTokens : outputTokens;
	return <div className="pgw-message-meta">
		<span className="pgw-model-badge"><WorkspaceIcon name="model" width={14} /> {model}</span>
		<span className="pgw-stats-switch" aria-label="Token statistics">
			<button type="button" aria-label="Prompt tokens" aria-pressed={view === "input"} onClick={() => setView("input")}><StatIcon name="book" /></button>
			<button type="button" aria-label="Generated tokens" aria-pressed={view === "output"} onClick={() => setView("output")}><StatIcon name="sparkles" /></button>
		</span>
		{count !== undefined && <span title={view === "input" ? "Prompt tokens from the last model turn" : "Generated tokens"}><StatIcon name="word" /> {count.toLocaleString()} tokens</span>}
		{seconds !== undefined && <span title="Elapsed response time, including tools and approvals"><StatIcon name="clock" /> {seconds.toFixed(1)}s</span>}
		{view === "output" && outputTokens !== undefined && seconds !== undefined && seconds > 0 && <span title="Average over elapsed response time, not model decoding speed"><StatIcon name="gauge" /> {(outputTokens / seconds).toFixed(2)} t/s</span>}
	</div>;
}
