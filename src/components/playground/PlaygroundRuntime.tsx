"use client";

import { useEffect, useRef, useState } from "react";

type Sandbox = { id: string; location: string; workspace: string; network: string; ephemeral: boolean };
type ExecutionEvent = { event: string; text?: string; stream?: string; exitCode?: number | null; stopped?: boolean; seconds?: number; message?: string };

/** Explicit manual execution. Chat/code blocks cannot silently invoke this executor. */
export default function PlaygroundRuntime({ open }: { open: boolean }) {
	const [sandbox, setSandbox] = useState<Sandbox | null>(null);
	const [mode, setMode] = useState<"inspect" | "build">("inspect");
	const [files, setFiles] = useState<string[]>([]);
	const [path, setPath] = useState("main.py");
	const [text, setText] = useState('print("Hello from the hosted sandbox")\n');
	const [original, setOriginal] = useState("");
	const [command, setCommand] = useState("python3 main.py");
	const [approved, setApproved] = useState(false);
	const [writeApproved, setWriteApproved] = useState(false);
	const [busy, setBusy] = useState(false);
	const [running, setRunning] = useState(false);
	const [output, setOutput] = useState("");
	const [status, setStatus] = useState("No code execution environment started.");
	const [error, setError] = useState("");
	const [activity, setActivity] = useState<string[]>([]);
	const [changes, setChanges] = useState(false);
	const abort = useRef<AbortController | null>(null);
	const consoleRef = useRef<HTMLPreElement>(null);
	useEffect(() => () => abort.current?.abort(), []);
	useEffect(() => { if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight; }, [output]);
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
		setSandbox(result); setOriginal(""); setApproved(false); setWriteApproved(false); setFiles([]); setOutput("");
		setStatus("Hosted Docker sandbox ready. No command has run."); record("Created isolated hosted workspace /workspace (network disabled).");
	});
	const stop = () => perform(async () => {
		if (!sandbox) return;
		try { await request(`/${sandbox.id}`, { method: "DELETE" }); }
		catch (failure) { if (!(failure && typeof failure === "object" && "status" in failure && failure.status === 404)) throw failure; }
		abort.current?.abort(); setSandbox(null); setRunning(false); setApproved(false); setWriteApproved(false); setFiles([]);
		setStatus("Sandbox stopped. Its temporary files were discarded."); record("Stopped sandbox and all its processes.");
	});
	const save = () => perform(async () => {
		if (!sandbox || mode !== "build" || !writeApproved) return;
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
	const run = async () => {
		if (!sandbox || mode !== "build" || !approved || busy || running || text !== original) return;
		const controller = new AbortController(); abort.current = controller;
		setRunning(true); setApproved(false); setOutput(""); setError(""); setStatus("Running in hosted Docker sandbox…");
		record(`Running in /workspace: ${command}`);
		try {
			const response = await fetch(`/api/playground/sandbox/${sandbox.id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command, approved: true }), signal: controller.signal });
			if (!response.ok || !response.body) {
				const detail = await response.json().catch(() => ({})) as { message?: string };
				throw new Error(detail.message || `Execution refused (${response.status}).`);
			}
			const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ""; let completed = false;
			const consume = (line: string) => {
				if (!line.startsWith("data:")) return;
				const event = JSON.parse(line.slice(5)) as ExecutionEvent;
				if (event.event === "execution.output") setOutput(previous => (previous + (event.stream === "stderr" ? "[stderr] " : "") + (event.text || "")).slice(-1024 * 1024));
				if (event.event === "execution.finished") {
					completed = true;
					const result = event.stopped ? "Stopped by sandbox limit; workspace discarded." : `Exited ${event.exitCode} · ${event.seconds}s · hosted Docker`;
					setStatus(result); record(result);
					if (event.stopped) { setSandbox(null); setFiles([]); }
				}
				if (event.event === "execution.failed") throw new Error(event.message || "Execution interrupted.");
			};
			try {
				for (;;) {
					const { done, value } = await reader.read(); pending += decoder.decode(value, { stream: !done });
					const lines = pending.split("\n"); pending = lines.pop() || ""; for (const line of lines) consume(line);
					if (done) { consume(pending); break; }
				}
				if (!completed) throw new Error("Execution ended without a completion event. Stop the workspace before retrying.");
			} finally { await reader.cancel().catch(() => undefined); }
			await refresh(sandbox.id).catch(() => undefined);
		} catch (failure) {
			if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "Execution failed."); setStatus("Execution interrupted; inspect the console and stop/reset the workspace."); }
		} finally { setRunning(false); if (abort.current === controller) abort.current = null; }
	};

	return <section id="pgw-manual-workspace" className="pgw-runtime" hidden={!open} aria-label="Hosted execution workspace">
		<header><h2>Manual workspace</h2><span>{sandbox ? "Hosted sandbox ready" : "Not started"}</span></header>
		<details className="pgw-runtime-limits"><summary>Python 3.11 · offline · temporary files</summary><p>Separate from chat. POSIX shell · 512 MB RAM · 30 seconds per command. Expires after 15 idle minutes or 1 hour total. Download files you need to keep. Chat responses are not execution results.</p></details>
		<div className="pgw-runtime-actions">
			<label>Workspace mode <select value={mode} disabled={running} onChange={event => { setMode(event.target.value as typeof mode); setApproved(false); setWriteApproved(false); }}><option value="inspect">Inspect · read only</option><option value="build">Build · explicit execution</option></select></label>
			{!sandbox ? <button type="button" className="pgw-outlined-button" disabled={busy} onClick={start}>Start hosted sandbox</button> : <><button type="button" className="pgw-outlined-button" disabled={busy} onClick={stop}>{running ? "Cancel and discard sandbox" : "Stop and discard sandbox"}</button><button type="button" className="pgw-text-button" disabled={busy || running} onClick={() => perform(() => refresh(sandbox.id))}>Refresh files</button></>}
		</div>
		<p role="status">{status}</p>{error && <p role="alert">{error}</p>}
		{sandbox && <div className="pgw-runtime-workspace"><nav aria-label="Workspace files"><b>/workspace</b>{files.map(file => <button key={file} type="button" title={file} disabled={busy || running} onClick={() => read(file)}>{file}</button>)}{!files.length && <p>No saved files.</p>}</nav><div>
			<label>Workspace-relative file path<input aria-label="Workspace file path" value={path} disabled={busy || running || mode !== "build"} maxLength={240} onChange={event => { setPath(event.target.value); setApproved(false); setWriteApproved(false); }} /></label>
			<textarea aria-label="Workspace file editor" spellCheck={false} value={text} disabled={busy || running || mode !== "build"} onChange={event => { setText(event.target.value); setApproved(false); setWriteApproved(false); }} />
			<label><input type="checkbox" checked={writeApproved} disabled={busy || running || mode !== "build"} onChange={event => setWriteApproved(event.target.checked)} />I reviewed this exact path and contents. Approve one sandbox write.</label>
			<div className="pgw-runtime-actions"><button type="button" className="pgw-outlined-button" disabled={busy || running || mode !== "build" || !writeApproved} onClick={save}>Save to sandbox</button><button type="button" className="pgw-text-button" onClick={() => setChanges(!changes)}>Review draft changes</button><button type="button" className="pgw-text-button" onClick={() => { const url = URL.createObjectURL(new Blob([text], { type: "text/plain" })); const link = document.createElement("a"); link.href = url; link.download = path.split("/").at(-1) || "file.txt"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download draft</button></div>
			{changes && <div className="pgw-runtime-diff"><div><b>Last saved/read version</b><pre>{original || "(new file)"}</pre></div><div><b>Draft · not executed</b><pre>{text}</pre></div></div>}
			<label>Command · runs in /workspace<input aria-label="Sandbox command" value={command} disabled={busy || running || mode !== "build"} maxLength={4000} onChange={event => { setCommand(event.target.value); setApproved(false); }} /></label>
			<label className="pgw-runtime-approval"><input type="checkbox" checked={approved} disabled={busy || running || mode !== "build"} onChange={event => setApproved(event.target.checked)} />I approve running this command in the hosted sandbox.</label>
			<button type="button" className="pgw-outlined-button" disabled={busy || running || !approved || mode !== "build" || text !== original || !command.trim()} onClick={() => void run()}>Run approved command</button>
			{text !== original && <p>Save the draft before running a command.</p>}
		</div></div>}
		{sandbox && <><h3>Console</h3><pre ref={consoleRef} className="pgw-runtime-console" aria-label="Sandbox console output">{output || "No commands run yet."}</pre></>}
		{activity.length > 0 && <details><summary>Execution activity</summary><ol>{activity.map((item, index) => <li key={index}>{item}</li>)}</ol></details>}
	</section>;
}
