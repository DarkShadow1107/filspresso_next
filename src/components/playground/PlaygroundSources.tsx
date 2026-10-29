"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import WorkspaceIcon from "./WorkspaceIcon";
import WorkspacePopover from "./WorkspacePopover";

export type SourceContext = { name: string; kind: string; text: string; size?: number; sourceUrl?: string; warnings?: string[] };
export type PendingSource = Partial<SourceContext> & { id: string; name: string; kind: string; status: "queued" | "reading" | "ready" | "error"; error?: string; preview?: string; file?: File };
const kindFor = (file: File) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name) ? "image" : file.type.startsWith("audio/") || /\.(wav|mp3|m4a|flac|ogg|aac|opus)$/i.test(file.name) ? "audio" : file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi)$/i.test(file.name) ? "video" : "document";

const IMPORT_GROUPS = [
	{ label: "Media", items: [
		{ label: "Images", detail: "PNG, JPEG, WebP, GIF, BMP, TIFF", icon: "image", accept: ".png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" },
		{ label: "Videos", detail: "MP4, WebM, MOV, MKV, AVI", icon: "video", accept: ".mp4,.webm,.mov,.mkv,.avi" },
		{ label: "Audio", detail: "MP3, WAV, M4A, FLAC, OGG, AAC, Opus", icon: "audio", accept: ".mp3,.wav,.m4a,.flac,.ogg,.aac,.opus" },
	] },
	{ label: "Documents", items: [
		{ label: "PDFs", detail: "PDF documents and scans", icon: "file", accept: ".pdf" },
		{ label: "Word documents", detail: "DOCX, ODT", icon: "file", accept: ".docx,.odt" },
		{ label: "Presentations", detail: "PPTX, ODP", icon: "file", accept: ".pptx,.odp" },
		{ label: "Excel & spreadsheets", detail: "XLSX, ODS, CSV, TSV", icon: "file", accept: ".xlsx,.ods,.csv,.tsv" },
	] },
	{ label: "Files & projects", items: [
		{ label: "Other files", detail: "Text, code, ZIP projects and other files", icon: "paperclip", accept: "" },
	] },
] as const;

export function AttachmentMenu({ disabled, onFiles }: { disabled: boolean; onFiles: (files: FileList) => void }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const file = useRef<HTMLInputElement>(null);
	const close = useCallback(() => setOpen(false), []);
	return <div className="pgw-attach-menu">
		<input type="file" className="pgw-hidden" ref={file} multiple aria-label="Upload attachments" onChange={(event) => { if (event.target.files) onFiles(event.target.files); event.target.value = ""; }} />
		<button ref={trigger} type="button" className="pgw-icon-button pgw-add-button" aria-label="Attach files" aria-haspopup="menu" aria-expanded={open} title="Import files" disabled={disabled} onClick={() => setOpen(!open)}><WorkspaceIcon name="plus" /></button>
		{open && !disabled && <WorkspacePopover anchor={trigger} onClose={close} label="Import files" className="pgw-import-menu" width={244}>
			{IMPORT_GROUPS.map((group) => <div role="group" aria-label={group.label} key={group.label}><p className="pgw-import-group">{group.label}</p>{group.items.map((item) => <button type="button" role="menuitem" key={item.label} title={item.detail} onClick={() => { if (!file.current) return; file.current.accept = item.accept; close(); trigger.current?.focus(); file.current.click(); }}><WorkspaceIcon name={item.icon} width={16} /><span>{item.label}</span></button>)}</div>)}<p className="pgw-import-note">8 sources · 20 MB each</p>
		</WorkspacePopover>}
	</div>;
}

export function usePlaygroundSources() {
	const [sources, setSources] = useState<PendingSource[]>([]);
	const [error, setError] = useState("");
	const controllers = useRef(new Map<string, AbortController>());
	const previews = useRef(new Map<string, string>());
	const queue = useRef(Promise.resolve());
	const count = useRef(0);
	useEffect(() => {
		const active = controllers.current; const urls = previews.current;
		return () => { active.forEach((controller) => controller.abort()); urls.forEach((url) => URL.revokeObjectURL(url)); };
	}, []);
	const update = (id: string, patch: Partial<PendingSource>) => setSources((previous) => previous.map((source) => source.id === id ? { ...source, ...patch } : source));
	const run = (source: PendingSource, url?: string) => {
		const controller = new AbortController();
		controllers.current.set(source.id, controller);
		queue.current = queue.current.catch(() => undefined).then(async () => {
			if (controller.signal.aborted) return;
			update(source.id, { status: "reading" });
			try {
				const form = new FormData();
				if (source.file) form.set("file", source.file);
				const response = await fetch(`/api/playground/context/${url ? "github" : "file"}`, {
					method: "POST", credentials: "include", body: url ? JSON.stringify({ url }) : form,
					headers: url ? { "Content-Type": "application/json" } : undefined, signal: controller.signal,
				});
				const body = await response.json() as SourceContext & { message?: string; error?: string; details?: { message?: string } };
				if (!response.ok) throw new Error(body.details?.message || body.message || body.error || "This source could not be read.");
				if (!body.text) throw new Error("No readable content was returned.");
				update(source.id, { ...body, status: "ready" });
			} catch (failure) {
				if (!controller.signal.aborted) update(source.id, { status: "error", error: failure instanceof Error ? failure.message : "The source could not be read." });
			} finally { controllers.current.delete(source.id); }
		});
	};
	const addFiles = (files: FileList | File[]) => {
		setError("");
		for (const file of Array.from(files)) {
			if (count.current >= 8) { setError("Attach up to 8 sources at a time."); break; }
			if (!file.size || file.size > 20 * 1024 * 1024) { setError(`${file.name}: choose a non-empty file no larger than 20 MB.`); continue; }
			const kind = kindFor(file);
			const preview = kind !== "document" ? URL.createObjectURL(file) : undefined;
			const source: PendingSource = { id: crypto.randomUUID(), name: file.name, size: file.size, kind, status: "queued", file, preview };
			if (preview) previews.current.set(source.id, preview);
			count.current++;
			setSources((previous) => [...previous, source]);
			run(source);
		}
	};
	const addGithub = (url: string) => {
		if (count.current >= 8) { setError("Attach up to 8 sources at a time."); return false; }
		const source: PendingSource = { id: crypto.randomUUID(), name: url.replace(/^https:\/\/github.com\//i, ""), sourceUrl: url, kind: "github", status: "queued" };
		count.current++; setError(""); setSources((previous) => [...previous, source]); run(source, url); return true;
	};
	const remove = (id: string) => {
		controllers.current.get(id)?.abort(); controllers.current.delete(id);
		const preview = previews.current.get(id); if (preview) URL.revokeObjectURL(preview); previews.current.delete(id);
		count.current = Math.max(0, count.current - 1);
		setSources((previous) => previous.filter((source) => source.id !== id));
	};
	const clear = () => { controllers.current.forEach((controller) => controller.abort()); controllers.current.clear(); previews.current.forEach((url) => URL.revokeObjectURL(url)); previews.current.clear(); count.current = 0; setSources([]); setError(""); };
	return { sources, error, addFiles, addGithub, remove, clear, ready: sources.every((source) => source.status === "ready"),
		contexts: sources.filter((source) => source.status === "ready").map(({ name, kind, text, size, warnings, sourceUrl }) => ({ name, kind, text: text!, size, warnings, sourceUrl })) };
}

export function SourceList({ sources, onRemove, disabled = false }: { sources: PendingSource[]; onRemove: (id: string) => void; disabled?: boolean }) {
	return <div className="pgw-sources" aria-label="Attached sources">{sources.map((source) => <div key={source.id} className="pgw-source" data-status={source.status}>
		<div className="pgw-source-heading"><WorkspaceIcon name={source.kind === "github" ? "github" : source.kind === "image" ? "image" : source.kind === "audio" ? "audio" : source.kind === "video" ? "video" : "file"} width={17} /><span title={source.name}>{source.name}</span><button type="button" className="pgw-icon-button" aria-label={`Remove ${source.name}`} disabled={disabled} onClick={() => onRemove(source.id)}><WorkspaceIcon name="close" width={13} /></button></div>
		{source.preview && source.kind === "image" && <img src={source.preview} alt={source.name} className="pgw-source-image" />}
		{source.preview && source.kind === "audio" && <audio src={source.preview} controls preload="metadata" />}
		{source.preview && source.kind === "video" && <video src={source.preview} controls preload="metadata" />}
		<p role="status">{source.status === "ready" ? "Ready" : source.status === "error" ? source.error : source.status === "queued" ? "Queued…" : source.kind === "document" || source.kind === "github" ? "Reading source…" : "Analyzing media…"}</p>
		{source.warnings?.length ? <details><summary>Source details</summary>{source.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details> : null}
	</div>)}</div>;
}

export function GithubProjectDialog({ onAdd, onClose }: { onAdd: (url: string) => boolean; onClose: () => void }) {
	const [url, setUrl] = useState("");
	const [error, setError] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const form = useRef<HTMLFormElement>(null);
	useEffect(() => { input.current?.focus(); }, []);
	return <div className="pgw-dialog-backdrop" onClick={(event) => { if (event.currentTarget === event.target) onClose(); }}><form ref={form} className="pgw-project-dialog" role="dialog" aria-modal="true" aria-labelledby="pgw-project-title" onKeyDown={(event) => {
		if (event.key === "Escape") onClose();
		if (event.key === "Tab") {
			const focusable = form.current?.querySelectorAll<HTMLElement>("input, button");
			if (!focusable?.length) return;
			if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
			else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
		}
	}} onSubmit={(event) => {
		event.preventDefault(); const value = url.trim();
		if (!/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}\/?$/i.test(value)) { setError("Enter a repository URL such as https://github.com/owner/project."); return; }
		if (onAdd(value)) onClose();
	}}>
		<h2 id="pgw-project-title"><WorkspaceIcon name="github" width={24} /> Add GitHub project</h2><p>Attach a public repository’s source snapshot to this conversation.</p>
		<label>Repository URL<input ref={input} type="url" placeholder="https://github.com/owner/project" value={url} onChange={(event) => setUrl(event.target.value)} required /></label>
		{error && <p role="alert" className="pgw-notice">{error}</p>}
		<div><button type="button" className="pgw-outlined-button" onClick={onClose}>Cancel</button><button type="submit" className="pgw-primary-button">Add project</button></div>
	</form></div>;
}
