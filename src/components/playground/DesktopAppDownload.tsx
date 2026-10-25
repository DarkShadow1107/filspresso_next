"use client";

import { useEffect, useRef, useState } from "react";

import { BrandWindowsIcon, TriangleAlertIcon } from "@/icons";
import { browserDesktopCompatibility, type DesktopCompatibility } from "@/lib/desktopCompatibility";
import DesktopCompatibilityDialog, { type InstallerPublicationInfo } from "./DesktopCompatibilityDialog";

/**
 * The desktop app's download.
 *
 * It was not on the page at all: the app existed, the backend could serve it, and
 * there was nowhere on the site that said so -- so "where do I get the desktop
 * app?" had no answer. It belongs here, on the page the app is an alternative
 * to: someone is in the Playground, they like it, and the app is the version
 * that runs on their own machine.
 *
 * The button is shown either way. The app *is* a Spectre feature, but the fact
 * that it exists is not a secret, and hiding it from someone who has not
 * subscribed yet is how a product nobody can find stays that way. What the
 * account without access gets is the button disabled and the reason written
 * out, not a 403 after the click.
 *
 * The flow is warn, acknowledge, then download, and the acknowledgement part
 * happens on the server on purpose: the checkbox in the popup is only UI state,
 * while the route that actually moves 80 megabytes confirms against a recorded
 * acknowledgement row for the version being served. `POST /api/desktop/installer/ack`
 * therefore runs before the download ever navigates.
 */

type InstallerInfo = {
	available: boolean;
	fileName: string;
	canDownload: boolean;
	downloadUrl: string;
	productVersion: string | null;
	sha256: string | null;
	bytes: number | null;
	unsigned: boolean;
	acknowledged: boolean;
	acknowledgementRequired: boolean;
};

function readInstallerInfo(body: Partial<InstallerInfo> | null): InstallerInfo | null {
	if (!body || typeof body !== "object") return null;
	return {
		available: Boolean(body.available),
		fileName: body.fileName ?? "Filspresso.Playground.msi",
		canDownload: Boolean(body.canDownload),
		downloadUrl: body.downloadUrl ?? "/api/desktop/download",
		productVersion: typeof body.productVersion === "string" ? body.productVersion : null,
		sha256: typeof body.sha256 === "string" ? body.sha256 : null,
		bytes: typeof body.bytes === "number" ? body.bytes : null,
		unsigned: body.unsigned ?? true,
		acknowledged: Boolean(body.acknowledged),
		acknowledgementRequired: body.acknowledgementRequired ?? true,
	};
}

function describeAckFailure(status: number, body: { error?: unknown; message?: unknown } | null): string {
	if (status === 401) return "Your session has expired. Sign in again, then try the download again.";
	if (status === 403) return "The desktop app comes with the Spectre Playground subscription.";
	if (status === 409) return "The version being offered has changed. Close this dialog and start again — the new version will be shown.";
	if (status === 503) return "The installer is not published right now, so the acknowledgement could not be recorded. Try again later.";
	if (body && typeof body.message === "string" && body.message) return body.message;
	return `The acknowledgement could not be recorded (HTTP ${status}).`;
}

export default function DesktopAppDownload() {
	const [info, setInfo] = useState<InstallerInfo | null>(null);
	const [busy, setBusy] = useState(false);
	const [checking, setChecking] = useState(false);
	const [compatibility, setCompatibility] = useState<DesktopCompatibility | null>(null);
	const [ackWorking, setAckWorking] = useState(false);
	const [ackError, setAckError] = useState<string | null>(null);
	const revision = useRef(0);
	useEffect(() => () => { revision.current++; }, []);

	const loadInstaller = (current: number) => {
		fetch("/api/desktop/installer", { credentials: "include", cache: "no-store" })
			.then((res) => (res.ok ? res.json() : null))
			.then((body: Partial<InstallerInfo> | null) => {
				if (current !== revision.current) return;
				const next = readInstallerInfo(body);
				// Silent only on absence: when the answer names an installer, show it.
				if (next) setInfo(next);
			})
			.catch(() => {
				// Silent: the button says the app is unavailable, which is the truth.
			});
	};

	// Note: the fetch result is recorded only if the component is still mounted
	// (revision guard), and a failed reload leaves the previous answer in place.
	useEffect(() => {
		const current = revision.current;
		loadInstaller(current);
	}, []);

	const inspect = async () => {
		if (!info?.canDownload || !info.available || checking || busy || ackWorking) return;
		setAckError(null);
		const current = ++revision.current;
		setCompatibility(null); setChecking(true);
		const result = await browserDesktopCompatibility(navigator);
		if (current === revision.current) setCompatibility(result);
	};
	const close = () => { revision.current++; setChecking(false); setCompatibility(null); setAckWorking(false); setAckError(null); };

	/**
	 * Warn has happened (the dialog is open); record the acknowledgement, and only
	 * then navigate. The navigation stays a plain `window.location.href`, so the
	 * browser handles the 80 MB stream itself and the file is never pulled through
	 * JavaScript into memory.
	 */
	const acknowledgeAndDownload = async (osClaim: string) => {
		if (!info?.canDownload || !info.available || !compatibility || !checking || ackWorking) return;
		if (!info.productVersion) {
			setAckError("The available package carries no recorded version, so it cannot be acknowledged. Try again later.");
			return;
		}
		setAckWorking(true); setAckError(null);
		try {
			const res = await fetch("/api/desktop/installer/ack", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ productVersion: info.productVersion, operatingSystem: osClaim }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				setAckError(describeAckFailure(res.status, body));
				// The server may have refused because the offered version changed; re-ask so
				// the facts shown in the still-open dialog are not stale. The browser probe
				// stays valid -- it does not depend on the installer version.
				loadInstaller(revision.current);
				return;
			}
		} catch {
			setAckError("The acknowledgement could not be recorded. Check your connection and try again.");
			return;
		} finally {
			setAckWorking(false);
		}
		close();
		setBusy(true);
		window.location.href = info.downloadUrl;
		// The navigation is not observable, so the button is released on a timer
		// rather than left spinning for ever.
		window.setTimeout(() => setBusy(false), 4000);
	};

	const locked = info !== null && !info.canDownload;
	const installerForDialog: InstallerPublicationInfo | null = info && info.available
		? { productVersion: info.productVersion, sha256: info.sha256, bytes: info.bytes, unsigned: info.unsigned }
		: null;

	return (
		<span className="playground-download">
			<button
				type="button"
				className="playground-ghost-button playground-download__button"
				onClick={() => { void inspect(); }}
				disabled={info === null || !info.available || !info.canDownload || busy || checking}
				title={
					locked
						? "The desktop app comes with the Spectre Playground subscription."
						: "Run the Playground as a Windows app"
				}
			>
				<BrandWindowsIcon size={15} />
				{busy ? "Starting…" : "Download Desktop App"}
			</button>
			{locked ? (
				<span className="playground-download__note">
					<TriangleAlertIcon size={13} /> Needs the Spectre subscription
				</span>
			) : null}
			{info && !info.available && <span className="playground-download__note">Desktop package unavailable</span>}
			{checking && (
				<DesktopCompatibilityDialog
					result={compatibility}
					installer={installerForDialog}
					onClose={close}
					onDownload={(osClaim) => { void acknowledgeAndDownload(osClaim); }}
					working={ackWorking}
					error={ackError}
					alreadyAcknowledged={Boolean(info?.acknowledged && info.productVersion)}
				/>
			)}
		</span>
	);
}
