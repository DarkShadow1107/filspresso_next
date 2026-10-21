"use client";

import { useEffect, useState } from "react";

import { BrandWindowsIcon, TriangleAlertIcon } from "@/icons";

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
 */

type InstallerInfo = {
	available: boolean;
	fileName: string;
	canDownload: boolean;
	downloadUrl: string;
};

export default function DesktopAppDownload() {
	const [info, setInfo] = useState<InstallerInfo | null>(null);
	const [busy, setBusy] = useState(false);

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
				// Silent: the button says the app is unavailable, which is the truth.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const start = () => {
		if (!info?.canDownload) return;
		setBusy(true);
		// A plain navigation, so the browser handles the download itself and the
		// file is never pulled through JavaScript into memory.
		window.location.href = info.downloadUrl;
		// The navigation is not observable, so the button is released on a timer
		// rather than left spinning for ever.
		window.setTimeout(() => setBusy(false), 4000);
	};

	const locked = info !== null && !info.canDownload;

	return (
		<span className="playground-download">
			<button
				type="button"
				className="playground-ghost-button playground-download__button"
				onClick={start}
				disabled={info === null || !info.canDownload || busy}
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
		</span>
	);
}
