"use client";

import { useRef, useState } from "react";
import { PLAYGROUND_MODEL_KEYS, CONTEXT_LEVELS, MODEL_LABEL_BY_KEY, TEXT_MODEL_230M, formatContextTokens, type ModelKey } from "@/lib/modelAccess";
import WorkspaceIcon from "./WorkspaceIcon";
import { COMPACTION_OPTIONS, type CompactionMode } from "@/lib/playgroundContext";
import PlaygroundDocumentsManager from "./PlaygroundDocuments";
import { DEFAULT_TOOL_PERMISSIONS, WEB_AGENT_TOOLS, normalizeToolPermissions, type ToolPermission, type ToolPermissions } from "@/lib/playgroundToolPermissions";

export type PlaygroundPreferences = {
	model: ModelKey;
	inputContextTokens: number;
	compactionMode: CompactionMode;
	thinking: boolean;
	textSize: "small" | "standard" | "large";
	enterToSend: boolean;
	toolPermissions: ToolPermissions;
};

export const DEFAULT_PREFERENCES: PlaygroundPreferences = {
	model: TEXT_MODEL_230M,
	inputContextTokens: CONTEXT_LEVELS[0],
	compactionMode: "balanced",
	thinking: false,
	textSize: "standard",
	enterToSend: true,
	toolPermissions: { ...DEFAULT_TOOL_PERMISSIONS },
};

export default function PlaygroundSettings({ preferences, thinkingAllowed, streaming, onSave, onExport, onImport, hasMessages }: {
	preferences: PlaygroundPreferences;
	thinkingAllowed: boolean;
	streaming: boolean;
	onSave: (next: PlaygroundPreferences) => boolean;
	onExport: () => void;
	onImport: (file: File) => Promise<void>;
	hasMessages: boolean;
}) {
	const [section, setSection] = useState<"general" | "display" | "tools" | "documents" | "transfer">("general");
	const [draft, setDraft] = useState(preferences);
	const [notice, setNotice] = useState("");
	const fileRef = useRef<HTMLInputElement>(null);
	const heading = section === "general" ? "General" : section === "display" ? "Display" : section === "tools" ? "Tool permissions" : section === "documents" ? "Documents" : "Import / Export";

	return (
		<div className="pgw-settings">
			<h1><WorkspaceIcon name="settings" width={28} height={28} /> Settings</h1>
			<div className="pgw-settings-layout">
				<nav className="pgw-settings-nav" aria-label="Settings sections">
					{([
						["general", "settings", "General"], ["display", "display", "Display"], ["tools", "settings", "Tools"], ["documents", "file", "Documents"], ["transfer", "transfer", "Import / Export"],
					] as const).map(([key, icon, label]) => (
						<button type="button" key={key} aria-current={section === key ? "page" : undefined} onClick={() => { setSection(key); setNotice(""); }}><WorkspaceIcon name={icon} />{label}</button>
					))}
				</nav>
				<section className="pgw-settings-panel" aria-label={heading}>
					<h2><WorkspaceIcon name={section === "transfer" ? "transfer" : section === "display" ? "display" : section === "documents" ? "file" : "settings"} /> {heading}</h2>
					{section === "general" && <>
						<label className="pgw-setting">
							<span>Default model</span>
							<select value={draft.model} disabled={streaming} onChange={(event) => setDraft({ ...draft, model: event.target.value as ModelKey })}>
								{PLAYGROUND_MODEL_KEYS.map((key) => <option key={key} value={key}>{MODEL_LABEL_BY_KEY[key]}</option>)}
							</select>
							<small>Available input limits are configuration options; a model’s validated context may be shorter. You can also switch models in the composer.</small>
						</label>
						<label className="pgw-setting">
							<span>Maximum input tokens</span>
							<select aria-label="Maximum input tokens" value={draft.inputContextTokens} disabled={streaming} onChange={(event) => setDraft({ ...draft, inputContextTokens: Number(event.target.value) })}>{CONTEXT_LEVELS.map((level) => <option key={level} value={level}>{formatContextTokens(level)}</option>)}</select>
							<small>Limits the prompt, conversation history, files and project sources. Output length is managed separately.</small>
						</label>
						<label className="pgw-setting"><span>Automatic context compaction</span>
							<select aria-label="Automatic context compaction" value={draft.compactionMode} disabled={streaming} onChange={event => setDraft({ ...draft, compactionMode: event.target.value as CompactionMode })}>{COMPACTION_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
							<small>Summarizes older conversation at the selected threshold. Recent turns and your original transcript are kept. Summary model usage is metered.</small>
						</label>
						{thinkingAllowed && <label className="pgw-switch-row"><span><b>Thinking mode</b><small>Show the model’s reasoning alongside its answer.</small></span><input type="checkbox" role="switch" checked={draft.thinking} disabled={streaming} onChange={(event) => setDraft({ ...draft, thinking: event.target.checked })} /></label>}
						<label className="pgw-switch-row"><span><b>Enter to send</b><small>Use Shift + Enter for a new line.</small></span><input type="checkbox" role="switch" checked={draft.enterToSend} onChange={(event) => setDraft({ ...draft, enterToSend: event.target.checked })} /></label>
					</>}
					{section === "display" && <>
						<label className="pgw-setting"><span>Message text size</span><select value={draft.textSize} onChange={(event) => setDraft({ ...draft, textSize: event.target.value as PlaygroundPreferences["textSize"] })}><option value="small">Small</option><option value="standard">Standard</option><option value="large">Large</option></select><small>Adjust the conversation’s text size without changing the rest of the interface.</small></label>
						<div className="pgw-type-preview" data-size={draft.textSize}><span>Preview</span><p>A little space to think. A direct conversation with your model.</p></div>
					</>}
					{section === "tools" && <>
						<p>Choose whether each web agent tool is allowed, asks each time, or is denied. These browser-wide preferences do not override server authorization, model availability or sandbox restrictions. Allowing a tool can perform future actions without another prompt.</p>
						<p>Web Playground cannot run code or commands, regardless of these settings. Settings apply to new agent runs, not an action already in progress.</p>
						{WEB_AGENT_TOOLS.map(name => <label className="pgw-setting" key={name}><span>{name.replaceAll("_", " ")}</span><select aria-label={`${name} permission`} disabled={streaming} value={normalizeToolPermissions(draft.toolPermissions)[name]} onChange={event => setDraft({ ...draft, toolPermissions: { ...normalizeToolPermissions(draft.toolPermissions), [name]: event.target.value as ToolPermission } })}><option value="allow">Allow</option><option value="ask">Ask each time</option><option value="deny">Deny</option></select></label>)}
					</>}
					{section === "documents" && <PlaygroundDocumentsManager streaming={streaming} />}
					{section === "transfer" && <>
						<div className="pgw-setting"><span>Export this conversation</span><small>Download the current messages as a JSON file.</small><button type="button" className="pgw-outlined-button" onClick={onExport} disabled={!hasMessages || streaming}><WorkspaceIcon name="download" /> Export conversation</button></div>
						<div className="pgw-setting"><span>Import a conversation</span><small>Open a previously exported Playground JSON file (up to 2 MB).</small><input ref={fileRef} className="pgw-hidden" type="file" accept="application/json,.json" aria-label="Import conversation file" onChange={async (event) => {
							const file = event.target.files?.[0];
							if (!file) return;
							try { await onImport(file); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not import that file."); }
							event.target.value = "";
						}} /><button type="button" className="pgw-outlined-button" disabled={streaming} onClick={() => fileRef.current?.click()}><WorkspaceIcon name="transfer" /> Import conversation</button></div>
					</>}
					<p className="pgw-settings-note">Preferences are saved in this browser. Conversation text, attached source text and tool activity are saved to your account, within the transcript size limit.</p>
					{notice && <p className="pgw-notice" role="status">{notice}</p>}
					{section !== "transfer" && <div className="pgw-settings-actions">
						<button type="button" className="pgw-outlined-button" disabled={streaming} onClick={() => { setDraft(DEFAULT_PREFERENCES); setNotice("Defaults restored. Save to apply them."); }}><WorkspaceIcon name="retry" /> Reset to default</button>
						<button type="button" className="pgw-primary-button" disabled={streaming} onClick={() => { const saved = onSave(draft); setNotice(saved ? "Settings saved." : "Applied for this page. Browser storage is unavailable."); }}>Save settings</button>
					</div>}
				</section>
			</div>
		</div>
	);
}
