"use client";

import { useEffect, useState } from "react";

import { ArrowNarrowDownIcon, TriangleAlertIcon } from "@/icons";

/**
 * The desktop app's download.
 *
 * It was not on the page at all: the app existed, the backend could serve it, and
 * there was nowhere on the site that said so -- so "where do I get the desktop
 * app?" had no answer.
 *
 * The card is always shown, even to an account without Spectre access. The app *is*
 * a Spectre feature, but the fact that it exists is not a secret: hiding it from
 * someone who has not subscribed yet is how a product nobody can find stays that
 * way. What the account without access gets is the button disabled and the reason
 * written out, not a 403 after the click.
 */

type InstallerInfo = {
	available: boolean;
	fileName: string;
	canDownload: boolean;
	downloadUrl: string;
};

export function DesktopAppDownload() {
	const [info, setInfo] = useState<InstallerInfo | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/desktop/installer", { credentials: "include", cache: "no-store" })
			.then((res) => (res.ok ? res.json() : null))
			.then((body: Partial<InstallerInfo> | null) => {
				if (cancelled || !body) return;
				setInfo({
					available: Boolean(body.available),
					fileName: body.fileName ?? "Filspresso.Playground.msi",
					canDownload: Boolean(body.canDownload),
					downloadUrl: body.downloadUrl ?? "/api/desktop/download",
				});
			})
			.catch(() => {
				// Silent: the card says the app is unavailable, which is the truth.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const start = () => {
		if (!info?.canDownload) return;
		setBusy(true);
		setError(null);
		// A plain navigation, so the browser handles the download itself and the file
		// is never pulled through JavaScript into memory.
		window.location.href = info.downloadUrl;
		// The navigation is not observable, so the button is released on a timer
		// rather than left spinning for ever.
		window.setTimeout(() => setBusy(false), 4000);
	};

	const locked = info !== null && !info.canDownload;

	return (
		<div className="card desktop-download">
			<h3 className="desktop-download__title">Desktop app</h3>
			<p className="billing-muted">
				Run the Spectre Playground as a Windows app: the same models, a local
				sandbox for the code it writes, and your account signed in.
			</p>

			{info === null ? (
				<p className="billing-muted">Checking for the installer…</p>
			) : info.available ? (
				<button
					type="button"
					className="btn-primary desktop-download__button"
					onClick={start}
					disabled={!info.canDownload || busy}
				>
					<ArrowNarrowDownIcon size={16} />
					{busy ? "Starting…" : `Download for Windows (${info.fileName})`}
				</button>
			) : (
				<p className="billing-muted">
					The Windows installer has not been published yet. It will appear here
					when it has.
				</p>
			)}

			{locked ? (
				<p className="desktop-download__note">
					<TriangleAlertIcon size={14} /> The desktop app comes with the Spectre
					Playground subscription.
				</p>
			) : null}
			{error ? <p className="billing-error">{error}</p> : null}
		</div>
	);
}
