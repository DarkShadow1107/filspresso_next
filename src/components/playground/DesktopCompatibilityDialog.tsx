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
		<h2 id="desktop-compatibility-title">Check your Windows setup</h2>
		<p role={result?.status === "unsupported" ? "alert" : "status"}>{result?.message ?? "Checking the operating-system hints available to this browser…"}</p>
		<p><strong>Installer: Windows x64, Windows 10 version 2004 or newer.</strong> Home is supported for inspection and the limited native-isolation option.</p>
		<ul>
			<li><strong>Windows Sandbox VM — preferred:</strong> Windows 11 24H2+, a supported Pro/Enterprise/Education edition, enabled virtualization, the Windows Sandbox feature and updated client. Administrator setup and a restart may be needed.</li>
			<li><strong>Native restricted mode — opt-in fallback:</strong> does not need the Windows Sandbox CLI. Uses AppContainer and process limits, shares the host kernel and has weaker isolation and tool compatibility. Not equivalent to a VM or Codex MXC.</li>
			<li><strong>Both:</strong> edit a staged project copy, approve commands and web requests separately, review diffs before applying to your project. Command networking and bundled developer toolchains are not included.</li>
		</ul>
		<p>The browser <strong>cannot verify</strong> Windows edition/build, virtualization, installed features, AppContainer policy or available development tools. The desktop app performs the authoritative checks and safety probes. Installing or enabling a feature does not unlock every feature automatically.</p>
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
		<h3>Before you download</h3>
		<ul>
			<li>
				<strong>The installer is not code-signed.</strong> Windows SmartScreen will likely
				show &ldquo;Windows protected your PC&rdquo; on first run; that warning is about the
				missing publisher certificate, not about this file specifically. You choose
				<em> More info &rarr; Run anyway</em>, or you verify the SHA-256 below before you run it.
			</li>
			<li>
				<strong>A heuristic antivirus may flag it.</strong> Unsigned MSIs are flagged
				far more often than they are malicious. Compare the checksum below before
				reporting the file as safe or unsafe; a mismatch is the moment to stop.
			</li>
			<li>
				<strong>Local admin approval and a restart may be needed</strong> to enable the
				Windows Sandbox feature (Windows 11 24H2+ Pro/Enterprise/Education). Enabling
				the feature unlocks the preferred runtime, not every tool in it.
			</li>
			<li>
				<strong>Nothing above this line is a check of your machine.</strong> The browser
				reads hints only; the installed app performs the authoritative probes after
				it runs. The acknowledgement below is also a server-recorded fact, per
				version, on your account.
			</li>
		</ul>
		<p className="desktop-download-facts">
			<strong>Package:</strong>{" "}
			{installer
				? <>
					{installer.productVersion ? <>version <code>{installer.productVersion}</code>, </> : null}
					{installer.bytes ? <>{formatBytes(installer.bytes)} </> : null}
					{installer.sha256 ? <>— SHA-256 <code style={{ wordBreak: "break-all" }}>{installer.sha256}</code></> : null}
					{installer.unsigned ? <> — <strong>not signed</strong> (see first warning)</> : null}
				</>
				: "not published yet"}
		</p>
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
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [osClaim, setOsClaim] = useState("");
	const [acknowledged, setAcknowledged] = useState(false);
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		dialog.current?.showModal();
		return () => { previous?.focus(); };
	}, []);
	return createPortal(<dialog ref={dialog} className="desktop-compatibility-dialog" aria-labelledby="desktop-compatibility-title"
		onCancel={(event) => { event.preventDefault(); if (!working) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}>
		<div>
			<DesktopCompatibilityDetails result={result} />
			<DesktopDownloadWarnings installer={installer} />
			<div className="desktop-compatibility-acknowledge">
				<label>
					<strong>Your operating system (stated, not verified):</strong>{" "}
					<select value={osClaim} onChange={(event) => setOsClaim(event.target.value)} disabled={working}>
						<option value="">Prefer not to say</option>
						{OPERATING_SYSTEM_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
					</select>
				</label>
				<label>
					<input type="checkbox" checked={acknowledged} disabled={working}
						onChange={(event) => setAcknowledged(event.target.checked)} />
					<span>I have read the warnings above. I know the installer is not signed and that SmartScreen may warn about it, and I want this version downloaded and recorded on my account.</span>
				</label>
				{alreadyAcknowledged ? <p className="desktop-download-note">A previous download of this version is already recorded on your account; a new line is not created.</p> : null}
				{error ? <p className="desktop-download-error" role="alert">{error}</p> : null}
			</div>
			<div className="desktop-compatibility-actions">
				<button type="button" onClick={onClose} autoFocus disabled={working}>Cancel</button>
				<button type="button" disabled={!result || !acknowledged || working}
					onClick={() => onDownload(osClaim)}>
					{working ? "Recording acknowledgement…" : "I understand — download Windows installer"}
				</button>
			</div>
		</div>
	</dialog>, document.body);
}
