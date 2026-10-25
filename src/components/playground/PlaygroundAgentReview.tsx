"use client";

import * as React from "react";
import { readAccountSession } from "@/lib/accountSession";
import { MODEL_LABEL_BY_KEY, formatContextTokens, isPlaygroundModelKey } from "@/lib/modelAccess";
import { NativeProposalReview, type ReviewContext, type ReviewMode } from "@/lib/playgroundAgentReview";
import type { NativeCall } from "@/lib/playgroundAgent";

/** Arguments/answers stay inert. Approval is unavailable: there is no connected executor. */
export function AgentProposalCard({ call }: { call: NativeCall }) {
	return <li className="pgw-recorded-event">
		<h3>{call.name} · Proposed, not executed</h3><p>Call {call.id} · Exact JSON arguments, untrusted data</p>
		<pre>{call.arguments}</pre>
		<button type="button" className="pgw-outlined-button" disabled>Execution approval unavailable</button>
		<p>No workspace is connected. Reviewing this proposal does not approve or run it.</p>
	</li>;
}

export default function PlaygroundAgentReview({ context }: { context: ReviewContext }) {
	const [review] = React.useState(() => new NativeProposalReview());
	const state = React.useSyncExternalStore(review.subscribe, review.getSnapshot, review.getSnapshot);
	const [mode, setMode] = React.useState<ReviewMode>("plan");
	const [prompt, setPrompt] = React.useState("");
	const busy = state.phase === "checking" || state.phase === "generating";
	const available = state.models.includes(context.model);
	React.useEffect(() => {
		const identity = () => {
			try { const profile = readAccountSession(); return profile?.email || profile?.username || null; }
			catch { return null; } // Unavailable profile storage must not preserve account-scoped results.
		};
		let account = identity();
		const changed = (event: Event) => {
			if (event instanceof StorageEvent && event.key !== null && event.key !== "account_profile") return;
			const next = identity();
			if (next !== account || next === null) { review.clear(true, "Account changed. Check native availability again."); setPrompt(""); }
			account = next;
		};
		window.addEventListener("session-update", changed); window.addEventListener("storage", changed);
		return () => { review.clear(true); window.removeEventListener("session-update", changed); window.removeEventListener("storage", changed); };
	}, [review]);
	return <section className="pgw-agent-review" aria-label="Agent proposal review">
		<h1>Agent proposal review</h1>
		<p>One explicitly requested, metered model turn. Proposals only: no file reads, writes, commands, approvals or automatic follow-ups. Ordinary chat and the manual execution workspace are separate.</p>
		<p>Model: hosted AI · This review: no connected executor · {isPlaygroundModelKey(context.model) ? MODEL_LABEL_BY_KEY[context.model] : "Unavailable model"} · {formatContextTokens(context.inputContextTokens)} input limit</p>
		<p>Model/context follow Chat settings. Changing settings, conversation or account discards this review. Chat messages and attached sources are not sent automatically.</p>
		<div className="pgw-history-actions">
			<button type="button" className="pgw-outlined-button" disabled={busy} onClick={() => void review.refresh()}>Check native availability</button>
			{busy && <button type="button" className="pgw-text-button" onClick={() => review.clear(false, "Review stopped. A generation may still have consumed billed tokens.")}>Stop review</button>}
		</div>
		<p role="status">{state.phase === "checking" ? "Checking native model capabilities…" : state.phase === "generating" ? "Generating proposals. No code is running in this review." : available ? "Native proposal transport configured. Execution approval is still unavailable." : "Native proposals unavailable for the selected model. No models are enabled by default; plain chat remains available."}</p>
		{state.error && <p role="alert">{state.error}</p>}
		<form onSubmit={event => { event.preventDefault(); void review.generate(context, mode, prompt); }}>
			<label>Proposal mode<select aria-label="Proposal mode" value={mode} disabled={busy} onChange={event => { review.clear(); setMode(event.target.value as ReviewMode); }}>
				<option value="plan">Plan · read proposals only</option><option value="build">Build proposals · cannot apply or execute</option>
			</select></label>
			<label>Review prompt<textarea aria-label="Review prompt" rows={4} maxLength={8000} value={prompt} disabled={busy} onChange={event => { review.clear(); setPrompt(event.target.value); }} /></label>
			<button type="submit" className="pgw-outlined-button" disabled={busy || !available || !prompt.trim()}>Generate proposals · billed model turn</button>
		</form>
		{state.result && <section aria-label="Native proposal result">
			<p>{state.result.reply.runId} · Reported model usage: {state.result.reply.usage.prompt_tokens} input / {state.result.reply.usage.completion_tokens} output tokens · Settlement recorded</p>
			{state.result.reply.text && <><h2>Model answer · unverified claims</h2><pre className="pgw-agent-answer">{state.result.reply.text}</pre></>}
			{state.result.reply.tool_calls.length === 0 ? <p>No native tool proposals were returned. Answer text/code blocks are not actions.</p> : <ul className="pgw-recorded-events" aria-label="Unexecuted tool proposals">{state.result.reply.tool_calls.map(call => <AgentProposalCard key={call.id} call={call} />)}</ul>}
			<button type="button" className="pgw-text-button" onClick={() => review.clear()}>Clear displayed review</button>
			<p>Clearing does not delete retained run metadata or undo billing. No tool results or approvals have been sent back.</p>
		</section>}
	</section>;
}
