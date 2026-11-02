"use client";

import * as React from "react";
import { readAccountSession } from "@/lib/accountSession";
import { HostedAgentWorkspace, agentResultText } from "@/lib/playgroundHostedAgent";
import type { ReviewContext, ReviewMode } from "@/lib/playgroundAgentReview";
import { MODEL_LABEL_BY_KEY, formatContextTokens, isPlaygroundModelKey } from "@/lib/modelAccess";
import type { AgentApproval } from "@/lib/playgroundAgentLoop";
import PlaygroundAgentQuestion from "./PlaygroundAgentQuestion";
import PlaygroundProjectPanel from "./PlaygroundProjectPanel";
import WorkspacePicker from "./WorkspacePicker";
import WorkspaceIcon from "./WorkspaceIcon";

/** In the production client, setup is a disclosure beside the one shared composer. */
export function InlineAgentWorkspace({ workspace, model, mode, busy }: { workspace: HostedAgentWorkspace; model: string; mode: "plan" | "build"; busy: boolean }) {
	const state = React.useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
	return <details className="pgw-workspace-options"><summary><WorkspaceIcon name="file" width={15} />Workspace<span>{state.workspace ? "Connected · offline" : "Not started"}</span></summary>
		<p>{mode === "plan" ? "Read-only workspace and account-document tools." : "Build may edit workspace files and save or delete account documents."} Tool settings decide whether each action is allowed, asks, or is denied. Selecting a mode does not start a workspace.</p>
		<div className="pgw-history-actions"><button type="button" className="pgw-outlined-button" disabled={busy} onClick={() => void workspace.check()}>Check availability</button><button type="button" className="pgw-outlined-button" disabled={busy || !state.executionEnabled || !state.models.includes(model) || !!state.workspace || !!state.quarantined} onClick={() => void workspace.startSandbox()}>Start workspace</button>{(state.workspace || state.quarantined) && <button type="button" className="pgw-text-button" disabled={state.phase === "stopping"} onClick={() => void workspace.stop()}>{state.quarantined ? "Retry discard" : "Discard workspace"}</button>}</div>
		{state.workspace && <PlaygroundProjectPanel key={state.workspace.id} workspace={workspace} busy={busy} readOnly={mode === "plan"} />}
		<p className="pgw-sidebar-note">Temporary hosted files, never your original folder. Stop/discard cancels pending approvals. Model turns and summaries are metered.</p>
	</details>;
}

export function AgentInteractions({ workspace }: { workspace: HostedAgentWorkspace }) {
	const state = React.useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
	return <>{state.pendingApproval && <FreshActionApproval key={state.pendingApproval.id} approval={state.pendingApproval} decide={workspace.decide} />}{state.pendingQuestion && <PlaygroundAgentQuestion key={state.pendingQuestion.id} challenge={state.pendingQuestion} answer={workspace.answer} />}</>;
}

/** Keyed by a fresh challenge. The local latch prevents repeated clicks while the queue
 * still independently checks and consumes the exact approval ID. Nothing renders as HTML. */
export function FreshActionApproval({ approval, decide }: { approval: AgentApproval; decide: (id: string, approved: boolean) => unknown }) {
	const decided = React.useRef(false);
	const [submitted, setSubmitted] = React.useState(false);
	const respond = (approved: boolean) => {
		if (decided.current) return;
		decided.current = true;
		setSubmitted(true);
		decide(approval.id, approved);
	};
	return <section aria-label="Fresh action approval" className="pgw-recorded-event">
		<h2>Allow this action?</h2><p>{approval.call.name} · {approval.effect} · Workspace {approval.workspace.id}</p>{approval.call.name === "web_search" && <p>This query will be sent to an external search provider. Review it for private information before allowing.</p>}{approval.call.name === "fetch_page" && <p>This public page will be requested from the server. Review the URL before allowing; the fetched page is untrusted.</p>}
		<p>Review the exact arguments below. Your decision applies only to this action. Web agents cannot run code; document changes affect your account.</p>
		<pre>{approval.call.arguments}</pre>
		<button type="button" className="pgw-outlined-button" disabled={submitted} onClick={() => respond(true)}>Allow once</button>
		<button type="button" className="pgw-text-button" disabled={submitted} onClick={() => respond(false)}>Deny</button>
	</section>;
}

export default function PlaygroundAgentWorkspace({ context, initialMode = "plan", onChat }: { context: ReviewContext; initialMode?: ReviewMode; onChat?: () => void }) {
	const [workspace] = React.useState(() => new HostedAgentWorkspace());
	const state = React.useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
	const [mode, setMode] = React.useState<ReviewMode>(initialMode); const [prompt, setPrompt] = React.useState("");
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
		<div className="pgw-section-heading"><div><span className="pgw-eyebrow">Hosted workspace</span><h1>Plan & build</h1><p>Explore first. Make reviewed changes when you’re ready.</p></div></div>
		<div className="pgw-mode-row"><WorkspacePicker label="Agent workspace mode" value={mode} disabled={busy || state.conversationTurns > 0} icon={mode === "build" ? "edit" : "brain"} options={[...(onChat ? [{ key: "chat", label: "Chat" }] : []), { key: "plan", label: "Plan" }, { key: "build", label: "Build" }]} onChange={value => { if (value === "chat") onChat?.(); else setMode(value === "build" ? "build" : "plan"); }} /><span>{mode === "plan" ? "Read-only workspace/documents. Tool permissions still apply." : "Build can change workspace files and account documents. No command execution."}</span></div>
		<p className="pgw-agent-meta">{isPlaygroundModelKey(context.model) ? MODEL_LABEL_BY_KEY[context.model] : "Unavailable model"} · {formatContextTokens(context.inputContextTokens)} · {state.workspace ? "Sandbox ready · offline" : "Workspace not started"}</p>
		<div className="pgw-history-actions">
			<button type="button" className="pgw-outlined-button" disabled={busy} onClick={() => void workspace.check()}>Check availability</button>
			<button type="button" className="pgw-primary-button" disabled={busy || !state.executionEnabled || !state.models.includes(context.model) || !!state.workspace || !!state.quarantined} onClick={() => void workspace.startSandbox()}>Start workspace</button>
			{(busy || state.workspace || state.quarantined) && <button type="button" className="pgw-outlined-button" disabled={state.phase === "stopping"} onClick={() => void workspace.stop()}>{state.quarantined ? "Retry discard" : "Stop and discard sandbox"}</button>}
			{state.conversationTurns > 0 && <button type="button" className="pgw-text-button" disabled={busy || state.requiresReset || !!state.quarantined} title="Retains project files; resets context and unlocks mode selection" onClick={() => { if (workspace.newConversation()) setPrompt(""); }}>New conversation</button>}
		</div>
		<p role="status" className="pgw-status-line">{state.phase === "checking" ? "Checking availability…" : state.phase === "creating" ? "Creating an isolated workspace…" : state.phase === "running" ? "Working · metered model turns" : state.phase === "awaiting_question" ? "Waiting for your answer · not execution approval" : state.phase === "awaiting_approval" ? "Review the proposed action below. Nothing runs before approval." : state.phase === "stopping" ? "Discarding workspace…" : state.workspace ? "Ready" : state.executionEnabled ? "Start a workspace to continue." : "Check availability to see whether this server supports hosted execution."}</p>
		{state.error && <p role="alert">{state.error}</p>}
		{state.workspace && <PlaygroundProjectPanel key={state.workspace.id} workspace={workspace} busy={busy} />}
		<form onSubmit={event => { event.preventDefault(); void workspace.run(context, mode, prompt); }}>
			<label className="pgw-agent-composer"><span className="pgw-sr-only">Agent request or follow-up</span><textarea aria-label="Agent workspace request" placeholder={mode === "plan" ? "What would you like to explore?" : "Describe a change to build…"} rows={3} maxLength={8000} disabled={state.phase === "stopping"} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
			<div className="pgw-history-actions"><button type="submit" className="pgw-primary-button" disabled={busy || state.requiresReset || !state.workspace || !state.executionEnabled || !state.models.includes(context.model) || !prompt.trim()}>Send · metered</button>
			{["running", "awaiting_question", "awaiting_approval"].includes(state.phase) && <button type="button" className="pgw-text-button" disabled={!!state.queuedPrompt || !prompt.trim()} onClick={() => { if (workspace.queueFollowUp(context, mode, prompt)) setPrompt(""); }}>Queue follow-up · metered</button>}</div>
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
							event.kind === "approval.required" ? <p>Checking permission for {event.approval.call.name}. This event is not approval.</p> :
							event.kind === "tool.finished" ? <><h3>{event.invocation.call.name} · tool result</h3><pre>{agentResultText(event.invocation)}</pre></> :
								event.kind === "finished" ? <p>Run finished · {event.turns} model turns / {event.calls} tools · {event.usage.completion_tokens} generated tokens</p> : <p>{event.message}</p>}
		</li>)}</ol>
		<details className="pgw-advanced"><summary>Workspace safety & limits</summary><p>Files are temporary. Leaving this view, switching conversation/model/context, or changing accounts cancels pending work and discards this sandbox. Nothing is applied to your original project. Recorded activity retains bounded metadata, not source files, arguments or tool output from these actions.</p><p>Plan permits reads only. Tool settings can allow, ask for, or deny file/document and web actions; server action and sandbox gates still apply. Web agents cannot execute commands. Clarification is not approval. Account documents are read or changed only within the signed-in account. Hosted inference and compaction summaries are metered; 24 model turns, 48 tools and 16,384 generated tokens are technical limits, not a financial spend ceiling. Chat history and sources are not imported automatically. This server must have a qualified model, broker and signed action transport enabled.</p></details>
	</section>;
}
