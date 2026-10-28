"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DesktopCompatibility } from "@/lib/desktopCompatibility";

/** The published package facts the warning block shows, as the server reports them. */
export type InstallerPublicationInfo = {
	productVersion: string | null;
	sha256: string | null;
	bytes: number | null;
	unsigned: boolean;
};

/**
 * The user-stated operating system. It is a claim, not a fact: the browser cannot
 * verify the Windows edition or build, the desktop app is the component that does
 * the authoritative probing, and the stored value is labelled "as stated" wherever
 * it is shown. It exists so the acknowledgement record says what the user believed
 * they were downloading for -- nothing downstream may treat it as a platform check.
 */
const OPERATING_SYSTEM_OPTIONS = [
	"Windows 11 24H2 or newer",
	"Windows 11 (earlier build)",
	"Windows 10 22H2",
	"Windows 10 (earlier build)",
	"Another operating system",
];

/** Explorer-style size, so the number on screen matches what the file manager shows. */
function formatBytes(bytes: number): string {
	const mebibytes = bytes / (1024 * 1024);
	const rounded = mebibytes >= 10 ? mebibytes.toFixed(1) : mebibytes.toFixed(2);
	return `${Number(rounded).toLocaleString()} MB (${bytes.toLocaleString()} bytes)`;
}

export function DesktopCompatibilityDetails({ result }: { result: DesktopCompatibility | null }) {
	return <>
		<h2 id="desktop-compatibility-title">Desktop for Windows</h2>
		<p role={result?.status === "unsupported" ? "alert" : "status"}>{result?.message ?? "Checking the operating-system hints available to this browser…"}</p>
		<dl className="desktop-system-facts" aria-label="Browser system check">
			<div><dt>System reported</dt><dd>{result?.osFamily ?? "Checking…"}</dd></div>
			<div><dt>Architecture</dt><dd>{result ? result.architecture === "x64" ? "x64 reported" : result.architecture === "other" ? "Not x64" : "Not exposed" : "Checking…"}</dd></div>
			<div><dt>Sandbox & virtualization</dt><dd>Requires installed-app check</dd></div>
		</dl>
		<p><strong>Requires Windows x64, version 2004+.</strong> Home is supported for inspection and opt-in native restricted mode.</p>
		<details className="desktop-setup-details"><summary>Execution requirements</summary>
			<p><strong>Windows Sandbox (preferred):</strong> Windows 11 24H2+ Pro/Enterprise/Education, virtualization and the Sandbox feature enabled. Admin approval and a restart may be needed.</p>
			<p><strong>Native restricted (opt-in):</strong> uses AppContainer and process limits; shares the host kernel. Weaker than a VM, not Codex MXC.</p>
			<p>Both edit a staged copy, with separate command/web approval and reviewed diffs. Command networking and bundled developer tools are not included.</p>
		</details>
		<p className="desktop-download-note">The browser <strong>cannot verify</strong> your exact build, edition or Windows features. In the app, open <strong>Plan / Build → Workspace setup → Verify</strong> for authoritative checks. Enabling a feature does not unlock every feature automatically.</p>
	</>;
}

/**
 * The ones that matter before the package runs. Written to be survived, not
 * reassuring: an unsigned MSI genuinely triggers SmartScreen and can trip a
 * heuristic antivirus, and the honest answer is "verify the checksum", not "click
 * through the warning".
 */
function DesktopDownloadWarnings({ installer }: { installer: InstallerPublicationInfo | null }) {
	return <>
		<p className="desktop-signing-warning"><strong>{installer?.unsigned !== false ? "Unsigned installer · not lifecycle-qualified." : "Install lifecycle not qualified."}</strong>{" "}
			{installer?.unsigned !== false ? "SmartScreen or antivirus may warn. Verify the checksum and source before running; do not bypass a warning you do not trust." : "Verify the package source before running."}</p>
		<details className="desktop-setup-details"><summary>Package details & checksum</summary>
		<p className="desktop-download-facts">
			<strong>Package:</strong>{" "}
			{installer
				? <>
					{installer.productVersion ? <>version <code>{installer.productVersion}</code>, </> : null}
					{installer.bytes ? <>{formatBytes(installer.bytes)} </> : null}
					{installer.sha256 ? <>— SHA-256 <code style={{ wordBreak: "break-all" }}>{installer.sha256}</code></> : null}
					{installer.unsigned ? <> — <strong>not signed</strong></> : null}
				</>
				: "not published yet"}
		</p>
		</details>
	</>;
}

export default function DesktopCompatibilityDialog({
	result,
	installer,
	onClose,
	onDownload,
	working = false,
	error = null,
	alreadyAcknowledged = false,
	onRecheck,
	checking = false,
}: {
	result: DesktopCompatibility | null;
	installer: InstallerPublicationInfo | null;
	onClose: () => void;
	/** Called only once the acknowledgement box is ticked; receives the user-stated OS. */
	onDownload: (operatingSystem: string) => void;
	/** True while the parent records the acknowledgement and has not navigated yet. */
	working?: boolean;
	/** Why the last acknowledgement attempt failed, when it did. */
	error?: string | null;
	alreadyAcknowledged?: boolean;
	onRecheck?: () => void;
	checking?: boolean;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [osClaim, setOsClaim] = useState("");
	const [acknowledged, setAcknowledged] = useState(false);
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		dialog.current?.showModal();
		return () => { document.body.style.overflow = overflow; previous?.focus(); };
	}, []);
	return createPortal(<dialog ref={dialog} className="desktop-compatibility-dialog" aria-labelledby="desktop-compatibility-title"
		onCancel={(event) => { event.preventDefault(); if (!working) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}>
		<div>
			<DesktopCompatibilityDetails result={result} />
			{onRecheck && <button type="button" className="desktop-recheck" onClick={onRecheck} disabled={working || checking}>{checking ? "Checking device…" : "Recheck device"}</button>}
			<DesktopDownloadWarnings installer={installer} />
			<div className="desktop-compatibility-acknowledge">
				<label>
					<span>Downloading for <small>(optional, self-reported)</small></span>
					<select value={osClaim} onChange={(event) => setOsClaim(event.target.value)} disabled={working}>
						<option value="">Prefer not to say</option>
						{OPERATING_SYSTEM_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
					</select>
				</label>
				<label>
					<input type="checkbox" checked={acknowledged} disabled={working}
						onChange={(event) => setAcknowledged(event.target.checked)} />
					<span>I understand this installer is {installer?.unsigned !== false ? "unsigned and " : ""}not lifecycle-qualified. Record my acknowledgement and download this version.</span>
				</label>
				{alreadyAcknowledged ? <p className="desktop-download-note">A previous download of this version is already recorded on your account; a new line is not created.</p> : null}
				{error ? <p className="desktop-download-error" role="alert">{error}</p> : null}
			</div>
			<div className="desktop-compatibility-actions">
				<button type="button" onClick={onClose} autoFocus disabled={working}>Cancel</button>
				<button type="button" disabled={!result || !acknowledged || working || checking}
					onClick={() => onDownload(osClaim)}>
					{working ? "Recording…" : "Download installer"}
				</button>
			</div>
		</div>
	</dialog>, document.body);
}
