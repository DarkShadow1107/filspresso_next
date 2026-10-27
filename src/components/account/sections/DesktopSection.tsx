"use client";

import { useCallback, useEffect, useState } from "react";
import { BrandWindowsIcon, RefreshIcon, TriangleAlertIcon } from "@/icons";

type DesktopInstallationsResponse = {
	acknowledgements: Array<{
		productVersion: string;
		osClaim: string | null;
		downloadCount: number;
		firstAcknowledgedAt: string;
		lastAcknowledgedAt: string;
		lastDownloadedAt: string | null;
	}>;
	installations: Array<{
		deviceId: string;
		deviceName: string | null;
		osEdition: string | null;
		osBuild: number | null;
		osUbr: number | null;
		appVersion: string | null;
		reportedAt: string;
	}>;
};

/**
 * The account's record of the desktop app, in one section.
 *
 * Two halves, from the single `GET /api/desktop/installations` endpoint:
 *
 * - "Playground installed on" — the facts the desktop app itself read from the machine
 *   it runs on (Windows edition, build, the running app version). Refreshed whenever the
 *   app's version changes. This is client-reported information, so it is shown as
 *   informational and never dressed up as a verification result.
 * - "Acknowledged downloads" — the server-recorded acknowledgement per published version,
 *   with the user-stated OS claim from the download dialog (labelled as stated, because
 *   the browser could not verify it) and the download counter.
 */
export function DesktopSection() {
	const [data, setData] = useState<DesktopInstallationsResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchRecord = useCallback(async () => {
		const res = await fetch("/api/desktop/installations", { credentials: "include", cache: "no-store" });
		if (!res.ok) throw new Error(`The desktop service answered ${res.status}.`);
		return (await res.json()) as DesktopInstallationsResponse;
	}, []);

	const reload = useCallback(async () => {
		try {
			setData(await fetchRecord());
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not load your desktop record.");
		} finally {
			setLoading(false);
		}
	}, [fetchRecord]);

	useEffect(() => {
		let cancelled = false;
		fetchRecord().then(
			(next) => {
				if (cancelled) return;
				setData(next);
				setError(null);
				setLoading(false);
			},
			(err: unknown) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Could not load your desktop record.");
				setLoading(false);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [fetchRecord]);

	if (loading) {
		return (
			<div className="card billing-card">
				<p className="billing-muted">Loading your desktop record…</p>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="card billing-card">
				<p className="billing-error">{error ?? "Could not load your desktop record."}</p>
				<button className="btn-secondary" onClick={() => void reload()}>
					<RefreshIcon size={16} /> Try again
				</button>
			</div>
		);
	}

	const installations = data.installations ?? [];
	const acks = data.acknowledgements ?? [];

	return (
		<div className="card billing-card">
			<h3 className="billing-card__title">
				<BrandWindowsIcon size={18} /> Desktop app
			</h3>

			<h4 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Playground installed on</h4>
			{installations.length === 0 ? (
				<p className="billing-muted">
					No installed copy of the Playground has reported in. The app sends this itself the
					first time it runs on a machine signed in to your account.
				</p>
			) : (
				<table className="billing-table">
					<thead>
						<tr>
							<th scope="col">Device</th>
							<th scope="col">Operating system (as reported by the app)</th>
							<th scope="col">App version</th>
							<th scope="col">Last seen</th>
						</tr>
					</thead>
					<tbody>
						{installations.map((row) => (
							<tr key={row.deviceId}>
								<td>{row.deviceName ?? "Unnamed device"}</td>
								<td>
									{row.osEdition
										? `${row.osEdition} build ${row.osBuild ?? "?"}.${row.osUbr ?? "?"}`
										: "Not reported"}
								</td>
								<td>{row.appVersion ?? "Not reported"}</td>
								<td>{new Date(row.reportedAt).toLocaleString()}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			<p className="billing-muted billing-footnote">
				Reported by the desktop app from the machine it runs on; the row refreshes when the app
				is running and its version or your Windows build changes.
			</p>

			<h4 style={{ margin: "1.25rem 0 0.5rem", fontSize: "0.95rem" }}>Acknowledged downloads</h4>
			{acks.length === 0 ? (
				<p className="billing-muted">
					You have not acknowledged a desktop download yet. Downloading the installer records
					the acknowledged version here, along with what you stated about your system.
				</p>
			) : (
				<table className="billing-table">
					<thead>
						<tr>
							<th scope="col">Version</th>
							<th scope="col">Downloads</th>
							<th scope="col">OS stated at acknowledgement</th>
							<th scope="col">Acknowledged</th>
							<th scope="col">Last download</th>
						</tr>
					</thead>
					<tbody>
						{acks.map((row, index) => (
							<tr key={`${row.productVersion}-${index}`}>
								<td>{row.productVersion}</td>
								<td>{row.downloadCount.toLocaleString()}</td>
								<td>{row.osClaim ?? "Not stated"}</td>
								<td>{new Date(row.lastAcknowledgedAt).toLocaleString()}</td>
								<td>{row.lastDownloadedAt ? new Date(row.lastDownloadedAt).toLocaleString() : "Not downloaded yet"}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			<p className="billing-muted billing-footnote">
				<TriangleAlertIcon size={12} /> The installed-OS row is what the app read from the machine; the
				&ldquo;OS stated&rdquo; column is what you chose in the download dialog and was never verified.
				Neither is an entitlement input.
			</p>
		</div>
	);
}
