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
			<section><h2>01 · Ask or create</h2><p>One composer can answer questions, research public pages and work with temporary files or your account documents when agent tools are available. Tool settings control whether each action is allowed, asks or is denied. The web Playground cannot run code or commands.</p><p>When the server cannot provide agent tools, choose <strong>Send without tools</strong> to send a plain chat message instead. Earlier messages are context data, never restored approvals.</p></section>
			<section><h2>02 · Add context</h2><p>Use + for files, or the GitHub icon for a project. Review prepared sources before sending. Choose the model, input limit and compaction setting in the composer. Compaction summaries and model follow-ups are metered.</p></section>
			<section><h2>03 · Keep what matters</h2><p>Conversations saves messages, source text and tool activity to your account, up to 200 messages or 700 KB per conversation. A warning appears if saving fails. Older sessions may contain only a checkpoint, because their messages were not saved. Export from Settings for a local copy.</p></section>
			<section><h2>04 · Review tool permissions</h2><p>The isolated temporary workspace starts automatically when agent tools need it and the server supports it. In Settings, choose Allow, Ask or Deny for each available tool. Allow may perform future actions without another prompt; Ask presents the exact action. Clarification answers are never approval. Search queries and URLs can leave the server. Workspace files are temporary; account documents stay private to your account.</p></section>
			<section><h2>Activity, not replay</h2><p>Activity shows retained run metadata and tool events. It is read-only, not a transcript or rerun. Logs can expire or be clipped; a missing completion record is not evidence that a job is still running.</p></section>
			<section><h2>Desktop is different</h2><p>The Windows app uses a local staged project and native system checks. A browser cannot read your Windows edition or confirm virtualization. Open the app’s own Instructions for its setup, update status and safety boundaries.</p></section>
		</div>
		<details className="pgw-advanced"><summary>Advanced tools</summary><p>The manual workspace lets you review and edit temporary files. The web Playground cannot run code or commands. Proposal preview is a diagnostic, single model turn with no executor.</p><div className="pgw-history-actions"><button type="button" className="pgw-outlined-button" disabled={advancedDisabled} onClick={onManual}>Manual workspace</button><button type="button" className="pgw-text-button" disabled={advancedDisabled} onClick={onPreview}>Proposal preview</button></div></details>
	</section></dialog>;
}
