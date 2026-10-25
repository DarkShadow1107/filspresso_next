import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";

import { DatabaseService } from "../database/database.service";

export type DesktopDeviceReport = {
	deviceId: string;
	deviceName: string | null;
	osEdition: string | null;
	osBuild: number | null;
	osUbr: number | null;
	appVersion: string | null;
};

export type DownloadAckRow = {
	productVersion: string;
	osClaim: string | null;
	downloadCount: number;
	firstAcknowledgedAt: string;
	lastAcknowledgedAt: string;
	lastDownloadedAt: string | null;
};

export type InstalledRow = {
	deviceId: string;
	deviceName: string | null;
	osEdition: string | null;
	osBuild: number | null;
	osUbr: number | null;
	appVersion: string | null;
	reportedAt: string;
};

/**
 * Server-side record of the download acknowledgement and the desktop app's device report.
 *
 * Why the acknowledgement lives here and not in the browser: the popup's warning checkbox
 * is a UI state. The command that actually moves 80 MB must itself confirm that the
 * account behind it acknowledged the *published* version, or a scripted client (or a stale
 * browser tab) downloads without the warning ever having been seen. The record therefore
 * doubles as the audit trail: one row per account+version, with the download counter and
 * the last download time.
 *
 * The device report is a different kind of fact and is labelled accordingly wherever the
 * account page shows it: the desktop app can read the real Windows edition/build/UBR, and
 * that is exactly why its report is useful -- but a report made by a client is data the
 * client chose to send. It is informational display data, never an input to entitlement.
 */
@Injectable()
export class DesktopInstallerRegistryService {
	private static readonly deviceRowCap = 8;
	/** Bounded limits chosen so a hostile client cannot bloat either table per account. */
	private static readonly ackVersionCap = 24;
	private static readonly deviceCap = DesktopInstallerRegistryService.deviceRowCap;

	constructor(private readonly db: DatabaseService) {}

	/**
	 * Record (or refresh) the acknowledgement for one published version.
	 *
	 * The version must match what the installer service would serve today. Acknowledging
	 * a version that is not the publisher's current release would create the right to
	 * download something the site is not offering; the mismatch is a client error.
	 */
	async acknowledge(accountId: number, productVersion: string, osClaim: string | null): Promise<void> {
		const client = await this.db.getPool().connect();
		try {
			const result = await client.query(
				`INSERT INTO desktop_download_acks (account_id, product_version, os_claim)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (account_id, product_version)
				 DO UPDATE SET os_claim = EXCLUDED.os_claim, last_acknowledged_at = NOW()`,
				[accountId, productVersion, osClaim],
			);
			if (result.rowCount === 0) throw new Error("ack upsert produced no row");
			await this.pruneAcks(client, accountId);
		} finally {
			client.release();
		}
	}

	/** Whether this account has acknowledged the given version. Must not throw into the download path shape. */
	async hasAck(accountId: number, productVersion: string): Promise<boolean> {
		const result = await this.db
			.getPool()
			.query("SELECT 1 FROM desktop_download_acks WHERE account_id = $1 AND product_version = $2 LIMIT 1", [
				accountId,
				productVersion,
			]);
		return (result.rowCount ?? 0) > 0;
	}

	/**
	 * Count one completed download of the acknowledged version.
	 *
	 * Best-effort by design: a transient database failure must not corrupt the headers
	 * already written to the socket. The acceptance test for this is that an audit write
	 * failure can take the telemetry, never the download. The row must exist (the ack
	 * gate ran before streaming), and if it does not the write is refused -- a download
	 * without an acknowledgement row is a bug, so the call fails loudly.
	 */
	async recordDownload(accountId: number, productVersion: string): Promise<void> {
		const client = await this.db.getPool().connect();
		try {
			const result = await client.query(
				`UPDATE desktop_download_acks
				   SET download_count = download_count + 1, last_downloaded_at = NOW()
				 WHERE account_id = $1 AND product_version = $2`,
				[accountId, productVersion],
			);
			if ((result.rowCount ?? 0) === 0) {
				throw new ForbiddenException({ error: "ACKNOWLEDGEMENT_REQUIRED" });
			}
		} finally {
			client.release();
		}
	}

	/**
	 * The desktop app's own facts about the machine it runs on, upserted per device.
	 *
	 * Normalisation deliberately mirrors the device grant: a value that cannot be a real
	 * edition/build/version is dropped, not clamped, so a malformed report shows as
	 * "unknown" instead of a plausible lie.
	 */
	async reportDeviceState(accountId: number, report: DesktopDeviceReport): Promise<void> {
		const client = await this.db.getPool().connect();
		try {
			const result = await client.query(
				`INSERT INTO desktop_device_state
				   (account_id, device_id, device_name, os_edition, os_build, os_ubr, app_version, reported_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
				 ON CONFLICT (account_id, device_id) DO UPDATE SET
				   device_name = EXCLUDED.device_name,
				   os_edition = EXCLUDED.os_edition,
				   os_build = EXCLUDED.os_build,
				   os_ubr = EXCLUDED.os_ubr,
				   app_version = EXCLUDED.app_version,
				   reported_at = NOW()`,
				[accountId, report.deviceId, report.deviceName, report.osEdition, report.osBuild, report.osUbr, report.appVersion],
			);
			if (result.rowCount === 0) throw new Error("device state upsert produced no row");
			await this.pruneDevices(client, accountId);
		} finally {
			client.release();
		}
	}

	/** The account page's view: every acknowledged version and every reported device. */
	async listForAccount(accountId: number): Promise<{ acknowledgements: DownloadAckRow[]; installations: InstalledRow[] }> {
		const client = await this.db.getPool().connect();
		try {
			const acks = await client.query(
				`SELECT product_version, os_claim, download_count,
				        first_acknowledged_at, last_acknowledged_at, last_downloaded_at
				 FROM desktop_download_acks WHERE account_id = $1
				 ORDER BY last_acknowledged_at DESC LIMIT 32`,
				[accountId],
			);
			const states = await client.query(
				`SELECT device_id, device_name, os_edition, os_build, os_ubr, app_version, reported_at
				 FROM desktop_device_state WHERE account_id = $1
				 ORDER BY reported_at DESC LIMIT 16`,
				[accountId],
			);
			return {
				acknowledgements: acks.rows.map(toAckRow),
				installations: states.rows.map(toInstalledRow),
			};
		} finally {
			client.release();
		}
	}

	/** Keep at most one screen of rows per account; the newest are kept. */
	private async pruneAcks(client: PoolClient, accountId: number): Promise<void> {
		await client.query(
			`DELETE FROM desktop_download_acks
			   WHERE account_id = $1 AND id NOT IN (
			     SELECT id FROM desktop_download_acks WHERE account_id = $1
			     ORDER BY last_acknowledged_at DESC LIMIT $2
			   )`,
			[accountId, DesktopInstallerRegistryService.ackVersionCap],
		);
	}

	private async pruneDevices(client: PoolClient, accountId: number): Promise<void> {
		await client.query(
			`DELETE FROM desktop_device_state
			   WHERE account_id = $1 AND id NOT IN (
			     SELECT id FROM desktop_device_state WHERE account_id = $1
			     ORDER BY reported_at DESC LIMIT $2
			   )`,
			[accountId, DesktopInstallerRegistryService.deviceCap],
		);
	}
}

/** Plausibility guard for the client-supplied version string in use for an ack. */
export function normalizeAckVersion(value: unknown): string {
	const text = String(value ?? "").trim();
	if (!/^[0-9]+(\.[0-9]+){1,3}$/.test(text)) {
		throw new BadRequestException({ error: "VERSION_REQUIRED", message: "Which product version was acknowledged must be stated." });
	}
	return text;
}

/**
 * The user-stated OS. Stored verbatim up to the column bound and shown with a
 * "as you stated" label; nothing downstream may treat it as a platform fact.
 */
export function normalizeOsClaim(value: unknown): string | null {
	const text = String(value ?? "").trim();
	if (!text || text.length > 64) return null;
	return text;
}

const EDITION_PATTERN = /^[A-Za-z][A-Za-z0-9 ]{0,63}$/;

export function normalizeDeviceReport(body: unknown): DesktopDeviceReport {
	const source = (body ?? {}) as Record<string, unknown>;
	const deviceId = String(source.deviceId ?? "").trim();
	if (!/^[0-9a-f-]{8,64}$/i.test(deviceId)) {
		throw new BadRequestException({ error: "DEVICE_REQUIRED", message: "A plausible device identifier is required." });
	}
	const deviceName = String(source.deviceName ?? "").trim();
	const edition = String(source.osEdition ?? "").trim();
	const build = Number(source.osBuild ?? 0);
	const ubr = Number(source.osUbr ?? 0);
	const appVersion = String(source.appVersion ?? "").trim();
	return {
		deviceId,
		deviceName: deviceName && deviceName.length <= 120 ? deviceName : null,
		osEdition: EDITION_PATTERN.test(edition) ? edition : null,
		osBuild: Number.isInteger(build) && build >= 10_000 && build <= 999_999 ? build : null,
		osUbr: Number.isInteger(ubr) && ubr >= 0 && ubr <= 1_000_000 ? ubr : null,
		appVersion: /^[0-9]+(\.[0-9]+){1,3}$/.test(appVersion) ? appVersion : null,
	};
}

function toAckRow(row: Record<string, unknown>): DownloadAckRow {
	return {
		productVersion: String(row.product_version ?? ""),
		osClaim: row.os_claim === null ? null : String(row.os_claim),
		downloadCount: Number(row.download_count ?? 0),
		firstAcknowledgedAt: new Date(row.first_acknowledged_at as Date).toISOString(),
		lastAcknowledgedAt: new Date(row.last_acknowledged_at as Date).toISOString(),
		lastDownloadedAt: row.last_downloaded_at ? new Date(row.last_downloaded_at as Date).toISOString() : null,
	};
}

function toInstalledRow(row: Record<string, unknown>): InstalledRow {
	return {
		deviceId: String(row.device_id ?? ""),
		deviceName: row.device_name === null ? null : String(row.device_name),
		osEdition: row.os_edition === null ? null : String(row.os_edition),
		osBuild: row.os_build === null ? null : Number(row.os_build),
		osUbr: row.os_ubr === null ? null : Number(row.os_ubr),
		appVersion: row.app_version === null ? null : String(row.app_version),
		reportedAt: new Date(row.reported_at as Date).toISOString(),
	};
}
