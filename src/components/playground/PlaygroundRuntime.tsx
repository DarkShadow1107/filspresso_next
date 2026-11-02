"use client";

import { useState } from "react";

type Sandbox = { id: string; location: string; workspace: string; network: string; ephemeral: boolean };
/** Manual temporary file workspace. The web Playground cannot run commands. */
export default function PlaygroundRuntime({ open }: { open: boolean }) {
	const [sandbox, setSandbox] = useState<Sandbox | null>(null);
	const [files, setFiles] = useState<string[]>([]);
	const [path, setPath] = useState("main.py");
	const [text, setText] = useState('print("Hello from the hosted sandbox")\n');
	const [original, setOriginal] = useState("");
	const [writeApproved, setWriteApproved] = useState(false);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("No temporary workspace started. Web code execution is unavailable.");
	const [error, setError] = useState("");
	const [activity, setActivity] = useState<string[]>([]);
	const [changes, setChanges] = useState(false);
	const record = (event: string) => setActivity(previous => [...previous.slice(-19), event]);
	const request = async (suffix = "", init?: RequestInit) => {
		const response = await fetch(`/api/playground/sandbox${suffix}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
		const body = await response.json();
		if (!response.ok) throw Object.assign(new Error(body.message || body.details?.message || body.error || `Sandbox operation failed (${response.status}).`), { status: response.status });
		return body;
	};
	const perform = async (operation: () => Promise<void>) => {
		setBusy(true); setError("");
		try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Sandbox operation failed."); }
		finally { setBusy(false); }
	};
	const refresh = async (id: string) => { const body = await request(`/${id}/files`); setFiles(body.files || []); };
	const start = () => perform(async () => {
		const result = await request("", { method: "POST" }) as Sandbox;
		setSandbox(result); setOriginal(""); setWriteApproved(false); setFiles([]);
		setStatus("Temporary workspace ready. Web code execution is unavailable."); record("Created isolated hosted workspace /workspace (network disabled).");
	});
	const stop = () => perform(async () => {
		if (!sandbox) return;
		try { await request(`/${sandbox.id}`, { method: "DELETE" }); }
		catch (failure) { if (!(failure && typeof failure === "object" && "status" in failure && failure.status === 404)) throw failure; }
		setSandbox(null); setWriteApproved(false); setFiles([]);
		setStatus("Sandbox stopped. Its temporary files were discarded."); record("Stopped sandbox and all its processes.");
	});
	const save = () => perform(async () => {
		if (!sandbox || !writeApproved) return;
		setWriteApproved(false);
		await request(`/${sandbox.id}/file`, { method: "PUT", body: JSON.stringify({ path, text, approved: true }) });
		setOriginal(text); record(`Saved /workspace/${path}`); await refresh(sandbox.id);
	});
	const read = (selected: string) => perform(async () => {
		if (!sandbox) return;
		if (text !== original) throw new Error("Save the current draft before opening another file.");
		const body = await request(`/${sandbox.id}/file?${new URLSearchParams({ path: selected })}`);
		setPath(body.path); setText(body.text); setOriginal(body.text); setWriteApproved(false); record(`Read /workspace/${body.path}`);
	});
	return <section id="pgw-manual-workspace" className="pgw-runtime" hidden={!open} aria-label="Hosted file workspace">
		<header><h2>Manual workspace</h2><span>{sandbox ? "Hosted sandbox ready" : "Not started"}</span></header>
		<details className="pgw-runtime-limits"><summary>Offline temporary files · no code execution</summary><p>The web Playground can read and edit temporary workspace files, but cannot run code or commands. The workspace expires after 15 idle minutes or one hour total; download files you need to keep.</p></details>
		<div className="pgw-runtime-actions">
			{!sandbox ? <button type="button" className="pgw-outlined-button" disabled={busy} onClick={start}>Start hosted sandbox</button> : <><button type="button" className="pgw-outlined-button" disabled={busy} onClick={stop}>Stop and discard sandbox</button><button type="button" className="pgw-text-button" disabled={busy} onClick={() => perform(() => refresh(sandbox.id))}>Refresh files</button></>}
		</div>
		<p role="status">{status}</p>{error && <p role="alert">{error}</p>}
		{sandbox && <div className="pgw-runtime-workspace"><nav aria-label="Workspace files"><b>/workspace</b>{files.map(file => <button key={file} type="button" title={file} disabled={busy} onClick={() => read(file)}>{file}</button>)}{!files.length && <p>No saved files.</p>}</nav><div>
			<label>Workspace-relative file path<input aria-label="Workspace file path" value={path} disabled={busy} maxLength={240} onChange={event => { setPath(event.target.value); setWriteApproved(false); }} /></label>
			<textarea aria-label="Workspace file editor" spellCheck={false} value={text} disabled={busy} onChange={event => { setText(event.target.value); setWriteApproved(false); }} />
			<label><input type="checkbox" checked={writeApproved} disabled={busy} onChange={event => setWriteApproved(event.target.checked)} />I reviewed this exact path and contents. Approve one sandbox write.</label>
			<div className="pgw-runtime-actions"><button type="button" className="pgw-outlined-button" disabled={busy || !writeApproved} onClick={save}>Save to sandbox</button><button type="button" className="pgw-text-button" onClick={() => setChanges(!changes)}>Review draft changes</button><button type="button" className="pgw-text-button" onClick={() => { const url = URL.createObjectURL(new Blob([text], { type: "text/plain" })); const link = document.createElement("a"); link.href = url; link.download = path.split("/").at(-1) || "file.txt"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download draft</button></div>
			{changes && <div className="pgw-runtime-diff"><div><b>Last saved/read version</b><pre>{original || "(new file)"}</pre></div><div><b>Draft · not executed</b><pre>{text}</pre></div></div>}
		</div></div>}
		{activity.length > 0 && <details><summary>Workspace activity</summary><ol>{activity.map((item, index) => <li key={index}>{item}</li>)}</ol></details>}
	</section>;
}
