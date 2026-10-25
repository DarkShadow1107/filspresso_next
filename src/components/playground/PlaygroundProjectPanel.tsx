"use client";

import * as React from "react";
import type { HostedAgentWorkspace } from "@/lib/playgroundHostedAgent";
import { createProjectArtifact, inertSourcePreview, projectChanges, validateProject, type ProjectFile } from "@/lib/playgroundProject";

/** Key by sandbox id. Local observations/downloads only; never source persistence on server. */
export default function PlaygroundProjectPanel({ workspace, busy }: { workspace: HostedAgentWorkspace; busy: boolean }) {
	const [files, setFiles] = React.useState<readonly ProjectFile[]>([]);
	const [baseline, setBaseline] = React.useState<readonly ProjectFile[] | null>(null);
	const [selected, setSelected] = React.useState<string | null>(null);
	const [error, setError] = React.useState(""); const [working, setWorking] = React.useState(false);
	const [imports, setImports] = React.useState<readonly ProjectFile[]>([]);
	const [reviewed, setReviewed] = React.useState(false);
	const live = React.useRef(true);
	React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const capture = async () => {
		if (busy || working) return; setWorking(true); setError("");
		try { const result = await workspace.captureProject(); if (live.current) { setFiles(result); setBaseline(previous => previous ?? result); } }
		catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : "Inspection failed."); }
		finally { if (live.current) setWorking(false); }
	};
	const download = async () => {
		if (busy || working) return; setWorking(true); setError("");
		try {
			const artifact = await createProjectArtifact(files); if (!live.current) return;
			const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" }));
			const link = document.createElement("a"); link.href = url; link.download = "filspresso-project.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch { if (live.current) setError("Artifact export failed."); }
		finally { if (live.current) setWorking(false); }
	};
	const file = files.find(file => file.path === selected); const changes = baseline ? projectChanges(baseline, files) : [];
	const stage = async (selected: FileList | null) => {
		if (!selected || busy || working) return; setWorking(true); setReviewed(false); setError("");
		try {
			if (selected.length > 256) throw new Error("Select at most 256 files.");
			let total = 0; const pending: ProjectFile[] = [];
			for (const file of Array.from(selected)) {
				total += file.size;
				if (file.size > 262144 || total > 8388608 || /^(?:\.env(?:\.|$)|credentials\.json$|id_rsa$|id_ed25519$)|\.(?:pem|key|pfx|p12)$/i.test(file.name)) throw new Error("File selection exceeds limits or includes a credential file.");
                pending.push({ path: file.webkitRelativePath || file.name, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()) });
			}
			const valid = validateProject(pending); if (live.current) setImports(valid);
		} catch (failure) { if (live.current) { setImports([]); setError(failure instanceof Error ? failure.message : "Import refused."); } }
		finally { if (live.current) setWorking(false); }
	};
	const uploadOne = async () => {
		if (busy || working || !reviewed || !imports[0]) return;
		const exact = imports[0]; setReviewed(false); setWorking(true); setError("");
		try { await workspace.uploadReviewedFile(exact, true); if (live.current) setImports(previous => previous.slice(1)); }
		catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : "Upload failed."); }
		finally { if (live.current) setWorking(false); }
	};
	return <section aria-label="Agent project explorer" className="pgw-recorded-event">
		<h2>Connected project · explorer, checkpoints and artifacts</h2>
		<label>Select local UTF-8 project files · not uploaded yet<input type="file" multiple disabled={busy || working} onChange={event => { void stage(event.target.files); event.target.value = ""; }} /></label>
		{imports[0] && <section key={imports[0].path}><h3>Review next import · {imports.length} remaining</h3><p>Replace /workspace/{imports[0].path}. This is a real file write, not a clarification answer.</p><pre>{imports[0].text}</pre><label><input type="checkbox" disabled={busy || working} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed this exact path and contents.</label><button type="button" disabled={busy || working || !reviewed} onClick={() => void uploadOne()}>Approve this file upload once</button><button type="button" disabled={working} onClick={() => { setImports([]); setReviewed(false); }}>Cancel remaining imports</button></section>}
		<p>Inspect the agent’s actual sandbox after it finishes. First inspection becomes the local comparison baseline. Refresh includes command-created files, not just agent write calls. Limits: 256 UTF-8 files, 256 KiB/file, 8 MiB total. Concurrent edits from another client are not an atomic snapshot.</p>
		<button type="button" disabled={busy || working} onClick={() => void capture()}>Inspect project files</button>
		<button type="button" disabled={busy || working || baseline === null} onClick={() => { setBaseline(files); setError(""); }}>Use current observation as baseline</button>
		<button type="button" disabled={busy || working || baseline === null} onClick={() => void download()}>Download bounded project + SHA-256 manifest</button>
		{error && <p role="alert">{error}</p>}
		<ul aria-label="Agent project files">{files.map(file => <li key={file.path}><button type="button" onClick={() => setSelected(file.path)}>{file.path}</button></li>)}</ul>
		<details><summary>{changes.length} changes since local baseline</summary>{changes.map(change => <section key={change.path}><h3>{change.kind} · {change.path}</h3><h4>Before</h4><pre>{change.before ?? "(absent)"}</pre><h4>After</h4><pre>{change.after ?? "(deleted)"}</pre></section>)}</details>
		{file && <details open><summary>Inert source preview · {file.path}</summary><p>Source text only. This does not execute HTML, JavaScript, CSS or a preview command.</p><iframe title="Isolated source preview" sandbox="" referrerPolicy="no-referrer" srcDoc={inertSourcePreview(file.text)} /></details>}
		<p>Downloads are inert JSON, not applied to your original project. No preview server, network proxy, port forwarding or automatic command is started.</p>
	</section>;
}
