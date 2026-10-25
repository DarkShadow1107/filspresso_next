"use client";

import * as React from "react";
import { readAccountSession } from "@/lib/accountSession";
import { HostedAgentWorkspace, agentResultText } from "@/lib/playgroundHostedAgent";
import type { ReviewContext, ReviewMode } from "@/lib/playgroundAgentReview";
import { MODEL_LABEL_BY_KEY, formatContextTokens, isPlaygroundModelKey } from "@/lib/modelAccess";
import type { AgentApproval } from "@/lib/playgroundAgentLoop";
import PlaygroundAgentQuestion from "./PlaygroundAgentQuestion";
import PlaygroundProjectPanel from "./PlaygroundProjectPanel";

/** Keyed by a fresh challenge: a second rapid click/key-repeat cannot approve a newly
 * arrived action without a separate review acknowledgement. Nothing renders as HTML. */
export function FreshActionApproval({ approval, decide }: { approval: AgentApproval; decide: (id: string, approved: boolean) => unknown }) {
	const [reviewed, setReviewed] = React.useState(false);
	return <section aria-label="Fresh action approval" className="pgw-recorded-event">
		<h2>Approve this action once?</h2><p>{approval.call.name} · {approval.effect} · Sandbox {approval.workspace.id}</p>
		<p>Exact JSON arguments · untrusted model data. Approval applies only to this action in this temporary sandbox. Commands may change or delete sandbox files.</p>
		<pre>{approval.call.arguments}</pre>
		<label><span><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I have reviewed this exact action and sandbox.</span></label>
		<button type="button" className="pgw-outlined-button" disabled={!reviewed} onClick={() => decide(approval.id, true)}>Approve once</button>
		<button type="button" className="pgw-text-button" onClick={() => decide(approval.id, false)}>Deny this action</button>
	</section>;
}

export default function PlaygroundAgentWorkspace({ context }: { context: ReviewContext }) {
	const [workspace] = React.useState(() => new HostedAgentWorkspace());
	const state = React.useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
	const [mode, setMode] = React.useState<ReviewMode>("plan"); const [prompt, setPrompt] = React.useState("");
	const busy = ["checking", "creating", "inspecting", "running", "awaiting_approval", "awaiting_question", "stopping"].includes(state.phase);
	React.useEffect(() => () => { void workspace.stop(true); }, [workspace, context.model, context.inputContextTokens, context.sessionUuid, context.compactionMode]);
	React.useEffect(() => {
		const identity = () => { try { const value = readAccountSession(); return value?.email || value?.username || null; } catch { return null; } };
		let account = identity();
		const changed = (event: Event) => {
			if (event instanceof StorageEvent && event.key !== null && event.key !== "account_profile") return;
			const next = identity(); if (next !== account || !next) { void workspace.stop(true); setPrompt(""); } account = next;
		};
		window.addEventListener("session-update", changed); window.addEventListener("storage", changed);
		return () => { void workspace.stop(true); window.removeEventListener("session-update", changed); window.removeEventListener("storage", changed); };
	}, [workspace]);
	return <section className="pgw-agent-review" aria-label="Agent sandbox workspace">
		<h1>Agent sandbox workspace</h1>
		<p>A bounded native-tool conversation, separate from ordinary Chat and proposal-only review. The agent can ask interactive clarification questions; your answers never approve execution. Model inference is hosted; code runs only in an explicitly started, offline hosted Docker sandbox—not on your computer or the application server.</p>
		<p>{isPlaygroundModelKey(context.model) ? MODEL_LABEL_BY_KEY[context.model] : "Unavailable model"} · {formatContextTokens(context.inputContextTokens)} input limit · {state.workspace ? `Sandbox ${state.workspace.id} · /workspace` : "No connected execution workspace"}</p>
		<p>Plan permits reads. Build asks for fresh approval for each exact file write or command. There is no blanket approval. Every model follow-up and summary is billed; limits are 24 model turns, 48 tools and 16,384 generated tokens including summaries, not a financial spend ceiling. Agent compaction follows your {context.compactionMode ?? "balanced"} setting and preserves complete recent call/result groups. No Chat history or attachments are imported automatically.</p>
		<div className="pgw-history-actions">
			<button type="button" className="pgw-outlined-button" disabled={busy} onClick={() => void workspace.check()}>Check agent availability</button>
			<button type="button" className="pgw-outlined-button" disabled={busy || !state.executionEnabled || !state.models.includes(context.model) || !!state.workspace || !!state.quarantined} onClick={() => void workspace.startSandbox()}>Start fresh hosted sandbox</button>
			<button type="button" className="pgw-outlined-button" disabled={state.phase === "stopping" || (!busy && !state.workspace && !state.quarantined)} onClick={() => void workspace.stop()}>{state.quarantined ? "Retry discard" : "Stop and discard sandbox"}</button>
			<button type="button" className="pgw-outlined-button" disabled={busy || state.requiresReset || !!state.quarantined} onClick={() => { if (workspace.newConversation()) setPrompt(""); }}>New conversation / change mode · retain project</button>
		</div>
		<p role="status">{state.phase === "checking" ? "Checking qualified model/executor availability…" : state.phase === "creating" ? "Creating an isolated temporary sandbox…" : state.phase === "running" ? "Agent running; subsequent model turns are metered." : state.phase === "awaiting_question" ? "Waiting for your clarification answers. No execution approval is implied." : state.phase === "awaiting_approval" ? "Waiting for your decision. No proposed mutation/command runs before approval." : state.phase === "stopping" ? "Discarding the actual sandbox workload…" : state.executionEnabled ? "Hosted action transport configured. Each proposal still requires server verification and a one-shot claim." : "Agent execution is disabled by default. Operator-qualified native models, action signing and a qualified broker are required."}</p>
		{state.error && <p role="alert">{state.error}</p>}
		{state.workspace && <PlaygroundProjectPanel key={state.workspace.id} workspace={workspace} busy={busy} />}
		<form onSubmit={event => { event.preventDefault(); void workspace.run(context, mode, prompt); }}>
			<label>Agent mode<select aria-label="Agent workspace mode" disabled={busy || state.conversationTurns > 0} value={mode} onChange={event => setMode(event.target.value as ReviewMode)}><option value="plan">Plan · workspace reads</option><option value="build">Build · fresh approval for writes/commands</option></select></label>
			<label>Agent request or follow-up<textarea aria-label="Agent workspace request" rows={4} maxLength={8000} disabled={state.phase === "stopping"} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
			<button type="submit" className="pgw-outlined-button" disabled={busy || state.requiresReset || !state.workspace || !state.executionEnabled || !state.models.includes(context.model) || !prompt.trim()}>Run agent · metered follow-ups</button>
			<button type="button" className="pgw-outlined-button" disabled={!["running", "awaiting_question", "awaiting_approval"].includes(state.phase) || !!state.queuedPrompt || !prompt.trim()} onClick={() => { if (workspace.queueFollowUp(context, mode, prompt)) setPrompt(""); }}>Queue one follow-up · metered</button>
			{state.queuedPrompt && <><p>Queued after successful completion only: {state.queuedPrompt}</p><button type="button" className="pgw-text-button" onClick={workspace.cancelQueued}>Cancel queued follow-up</button></>}
		</form>
		{state.requiresReset && <p role="alert">This run did not complete. Stop and discard before starting fresh; partial execution history is not silently reused.</p>}
		{state.pendingApproval && <FreshActionApproval key={state.pendingApproval.id} approval={state.pendingApproval} decide={workspace.decide} />}
		{state.pendingQuestion && <PlaygroundAgentQuestion key={state.pendingQuestion.id} challenge={state.pendingQuestion} answer={workspace.answer} />}
		<ol className="pgw-recorded-events" aria-label="Agent activity and tool output">{state.events.map((event, index) => <li key={index} className="pgw-recorded-event">
			{event.kind === "user.message" ? <><h3>You</h3><pre>{event.text}</pre></> : event.kind === "question.required" ? <p>Agent asked for clarification. This is not an execution request.</p> : event.kind === "question.answered" ? <><h3>Your clarification answers · not execution consent</h3><pre>{JSON.stringify(event.decision.answers, null, 2)}</pre></> : event.kind === "model.receipt" ? <p>{event.runId} · {event.usage.prompt_tokens} input / {event.usage.completion_tokens} output tokens · Settlement recorded</p> :
				event.kind === "context.compacted" ? <details><summary>Context compacted · {event.context.tokensBefore} → {event.context.tokensAfter} tokens · {event.context.consumedGroups} older complete groups summarized</summary><p>Quoted memory, not approval or execution evidence. Original local activity is retained; summary tokens are included in the turn receipt.</p><pre>{event.context.summary}</pre></details> :
				event.kind === "message" ? <><h3>Model answer · claims require tool evidence</h3><pre>{event.text}</pre></> :
					event.kind === "tool.proposed" ? <><h3>{event.call.name} · proposed, not yet executed</h3><pre>{event.call.arguments}</pre></> :
						event.kind === "approval.required" ? <p>Fresh consent required for {event.approval.call.name}. This event is not approval.</p> :
							event.kind === "tool.finished" ? <><h3>{event.invocation.call.name} · tool result</h3><pre>{agentResultText(event.invocation)}</pre></> :
								event.kind === "finished" ? <p>Run finished · {event.turns} model turns / {event.calls} tools · {event.usage.completion_tokens} generated tokens</p> : <p>{event.message}</p>}
		</li>)}</ol>
		<p>Files are temporary. Leaving this view, switching conversation/model/context, or changing accounts cancels pending work and discards this sandbox. Nothing is applied to your original project. Recorded activity retains bounded metadata, not source files, arguments or tool output from these actions.</p>
	</section>;
}
