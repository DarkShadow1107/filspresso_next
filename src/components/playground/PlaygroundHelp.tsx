"use client";

import WorkspaceIcon from "./WorkspaceIcon";
import { useEffect, useRef } from "react";

/** Browser-only instructions. Native Windows setup deliberately belongs to desktop help. */
export default function PlaygroundHelp({ onManual, onPreview, onClose, advancedDisabled = false }: { onManual: () => void; onPreview: () => void; onClose: () => void; advancedDisabled?: boolean }) {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden"; dialog.current?.showModal();
		return () => { document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
	}, []);
	return <dialog ref={dialog} className="pgw-help-dialog" aria-label="Web Playground instructions" onCancel={event => { event.preventDefault(); onClose(); }}>
		<button type="button" className="pgw-icon-button pgw-help-close" aria-label="Close instructions" onClick={onClose}><WorkspaceIcon name="close" /></button>
		<section className="pgw-help">
		<div className="pgw-section-heading"><WorkspaceIcon name="help" width={26} /><div><span className="pgw-eyebrow">Browser guide</span><h1>Using the web Playground</h1><p>Your models are hosted. No code runs on your computer.</p></div></div>
		<div className="pgw-help-topics">
			<section><h2>01 · Choose a mode</h2><p>One thread and composer for <strong>Chat</strong>, <strong>Plan</strong> and <strong>Build</strong>. Chat answers questions and analyses attachments. Plan reads the hosted workspace. Build can edit and test staged files, with fresh approval for each write or command.</p><p>Changing mode keeps your draft and visible history. Earlier messages are context data, never instructions or restored approvals. Selecting a mode never starts a sandbox or grants permission. If tools are unavailable on this server, Chat still works.</p></section>
			<section><h2>02 · Add context</h2><p>Use + for files, or the GitHub icon for a project. Review prepared sources before sending. Choose the model, input limit and compaction setting in the composer. Compaction summaries and model follow-ups are metered.</p></section>
			<section><h2>03 · Keep what matters</h2><p>Conversations saves messages, source text and tool activity to your account, up to 200 messages or 700 KB per conversation. A warning appears if saving fails. Older sessions may contain only a checkpoint, because their messages were not saved. Export from Settings for a local copy.</p></section>
			<section><h2>04 · Review before running</h2><p>Open Workspace above the composer and start a hosted workspace explicitly. Plan cannot write or run commands. Build requests exact, one-use approval; clarification answers are never approval. A model-selected web search also needs approval because the query is sent externally. Commands remain offline and files are temporary. New conversation or changing model/context discards the workspace; download files you need to keep.</p></section>
			<section><h2>Activity, not replay</h2><p>Activity shows retained run metadata and tool events. It is read-only, not a transcript or rerun. Logs can expire or be clipped; a missing completion record is not evidence that a job is still running.</p></section>
			<section><h2>Desktop is different</h2><p>The Windows app uses a local staged project and native system checks. A browser cannot read your Windows edition or confirm virtualization. Open the app’s own Instructions for its setup, update status and safety boundaries.</p></section>
		</div>
		<details className="pgw-advanced"><summary>Advanced tools</summary><p>Manual workspace is for your own explicitly approved commands. Proposal preview is a diagnostic, single model turn with no executor—not another agent mode. Neither grants the conversation permission to execute.</p><div className="pgw-history-actions"><button type="button" className="pgw-outlined-button" disabled={advancedDisabled} onClick={onManual}>Manual workspace</button><button type="button" className="pgw-text-button" disabled={advancedDisabled} onClick={onPreview}>Proposal preview</button></div></details>
	</section></dialog>;
}
