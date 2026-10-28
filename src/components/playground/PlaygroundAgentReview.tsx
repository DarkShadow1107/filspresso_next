"use client";

import * as React from "react";
import { readAccountSession } from "@/lib/accountSession";
import { MODEL_LABEL_BY_KEY, formatContextTokens, isPlaygroundModelKey } from "@/lib/modelAccess";
import { NativeProposalReview, type ReviewContext, type ReviewMode } from "@/lib/playgroundAgentReview";
import type { NativeCall } from "@/lib/playgroundAgent";
import WorkspacePicker from "./WorkspacePicker";

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
		<span className="pgw-eyebrow">Advanced · no executor</span><h1>Proposal preview</h1>
		<p>Preview one metered model turn. Suggestions only—nothing is read, changed or executed.</p>
		<p>{isPlaygroundModelKey(context.model) ? MODEL_LABEL_BY_KEY[context.model] : "Unavailable model"} · {formatContextTokens(context.inputContextTokens)} input</p>
		<details className="pgw-advanced"><summary>When is this useful?</summary><p>This diagnostic previews native tool suggestions, without a connected workspace, execution approvals or automatic follow-ups. Use Plan / Build for actual project work. Model/context follow Chat settings. Changing settings, conversation or account clears the preview; Chat messages and attachments are not sent automatically.</p></details>
		<div className="pgw-history-actions">
			<button type="button" className="pgw-outlined-button" disabled={busy} onClick={() => void review.refresh()}>Check model</button>
			{busy && <button type="button" className="pgw-text-button" onClick={() => review.clear(false, "Review stopped. A generation may still have consumed billed tokens.")}>Stop review</button>}
		</div>
		<p role="status">{state.phase === "checking" ? "Checking native model capabilities…" : state.phase === "generating" ? "Generating proposals. No code is running in this review." : available ? "Native proposal transport configured. Execution approval is still unavailable." : "Native proposals unavailable for the selected model. No models are enabled by default; plain chat remains available."}</p>
		{state.error && <p role="alert">{state.error}</p>}
		<form onSubmit={event => { event.preventDefault(); void review.generate(context, mode, prompt); }}>
			<WorkspacePicker label="Proposal mode" icon="brain" value={mode} disabled={busy} options={[{ key: "plan", label: "Plan suggestions" }, { key: "build", label: "Build suggestions" }]} onChange={value => { review.clear(); setMode(value === "build" ? "build" : "plan"); }} />
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
