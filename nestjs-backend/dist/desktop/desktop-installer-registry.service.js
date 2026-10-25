"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DesktopInstallerRegistryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopInstallerRegistryService = void 0;
exports.normalizeAckVersion = normalizeAckVersion;
exports.normalizeOsClaim = normalizeOsClaim;
exports.normalizeDeviceReport = normalizeDeviceReport;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
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
let DesktopInstallerRegistryService = class DesktopInstallerRegistryService {
    static { DesktopInstallerRegistryService_1 = this; }
    db;
    static deviceRowCap = 8;
    /** Bounded limits chosen so a hostile client cannot bloat either table per account. */
    static ackVersionCap = 24;
    static deviceCap = DesktopInstallerRegistryService_1.deviceRowCap;
    constructor(db) {
        this.db = db;
    }
    /**
     * Record (or refresh) the acknowledgement for one published version.
     *
     * The version must match what the installer service would serve today. Acknowledging
     * a version that is not the publisher's current release would create the right to
     * download something the site is not offering; the mismatch is a client error.
     */
    async acknowledge(accountId, productVersion, osClaim) {
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query(`INSERT INTO desktop_download_acks (account_id, product_version, os_claim)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (account_id, product_version)
				 DO UPDATE SET os_claim = EXCLUDED.os_claim, last_acknowledged_at = NOW()`, [accountId, productVersion, osClaim]);
            if (result.rowCount === 0)
                throw new Error("ack upsert produced no row");
            await this.pruneAcks(client, accountId);
        }
        finally {
            client.release();
        }
    }
    /** Whether this account has acknowledged the given version. Must not throw into the download path shape. */
    async hasAck(accountId, productVersion) {
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
    async recordDownload(accountId, productVersion) {
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query(`UPDATE desktop_download_acks
				   SET download_count = download_count + 1, last_downloaded_at = NOW()
				 WHERE account_id = $1 AND product_version = $2`, [accountId, productVersion]);
            if ((result.rowCount ?? 0) === 0) {
                throw new common_1.ForbiddenException({ error: "ACKNOWLEDGEMENT_REQUIRED" });
            }
        }
        finally {
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
    async reportDeviceState(accountId, report) {
        const client = await this.db.getPool().connect();
        try {
            const result = await client.query(`INSERT INTO desktop_device_state
				   (account_id, device_id, device_name, os_edition, os_build, os_ubr, app_version, reported_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
				 ON CONFLICT (account_id, device_id) DO UPDATE SET
				   device_name = EXCLUDED.device_name,
				   os_edition = EXCLUDED.os_edition,
				   os_build = EXCLUDED.os_build,
				   os_ubr = EXCLUDED.os_ubr,
				   app_version = EXCLUDED.app_version,
				   reported_at = NOW()`, [accountId, report.deviceId, report.deviceName, report.osEdition, report.osBuild, report.osUbr, report.appVersion]);
            if (result.rowCount === 0)
                throw new Error("device state upsert produced no row");
            await this.pruneDevices(client, accountId);
        }
        finally {
            client.release();
        }
    }
    /** The account page's view: every acknowledged version and every reported device. */
    async listForAccount(accountId) {
        const client = await this.db.getPool().connect();
        try {
            const acks = await client.query(`SELECT product_version, os_claim, download_count,
				        first_acknowledged_at, last_acknowledged_at, last_downloaded_at
				 FROM desktop_download_acks WHERE account_id = $1
				 ORDER BY last_acknowledged_at DESC LIMIT 32`, [accountId]);
            const states = await client.query(`SELECT device_id, device_name, os_edition, os_build, os_ubr, app_version, reported_at
				 FROM desktop_device_state WHERE account_id = $1
				 ORDER BY reported_at DESC LIMIT 16`, [accountId]);
            return {
                acknowledgements: acks.rows.map(toAckRow),
                installations: states.rows.map(toInstalledRow),
            };
        }
        finally {
            client.release();
        }
    }
    /** Keep at most one screen of rows per account; the newest are kept. */
    async pruneAcks(client, accountId) {
        await client.query(`DELETE FROM desktop_download_acks
			   WHERE account_id = $1 AND id NOT IN (
			     SELECT id FROM desktop_download_acks WHERE account_id = $1
			     ORDER BY last_acknowledged_at DESC LIMIT $2
			   )`, [accountId, DesktopInstallerRegistryService_1.ackVersionCap]);
    }
    async pruneDevices(client, accountId) {
        await client.query(`DELETE FROM desktop_device_state
			   WHERE account_id = $1 AND id NOT IN (
			     SELECT id FROM desktop_device_state WHERE account_id = $1
			     ORDER BY reported_at DESC LIMIT $2
			   )`, [accountId, DesktopInstallerRegistryService_1.deviceCap]);
    }
};
exports.DesktopInstallerRegistryService = DesktopInstallerRegistryService;
exports.DesktopInstallerRegistryService = DesktopInstallerRegistryService = DesktopInstallerRegistryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], DesktopInstallerRegistryService);
/** Plausibility guard for the client-supplied version string in use for an ack. */
function normalizeAckVersion(value) {
    const text = String(value ?? "").trim();
    if (!/^[0-9]+(\.[0-9]+){1,3}$/.test(text)) {
        throw new common_1.BadRequestException({ error: "VERSION_REQUIRED", message: "Which product version was acknowledged must be stated." });
    }
    return text;
}
/**
 * The user-stated OS. Stored verbatim up to the column bound and shown with a
 * "as you stated" label; nothing downstream may treat it as a platform fact.
 */
function normalizeOsClaim(value) {
    const text = String(value ?? "").trim();
    if (!text || text.length > 64)
        return null;
    return text;
}
const EDITION_PATTERN = /^[A-Za-z][A-Za-z0-9 ]{0,63}$/;
function normalizeDeviceReport(body) {
    const source = (body ?? {});
    const deviceId = String(source.deviceId ?? "").trim();
    if (!/^[0-9a-f-]{8,64}$/i.test(deviceId)) {
        throw new common_1.BadRequestException({ error: "DEVICE_REQUIRED", message: "A plausible device identifier is required." });
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
function toAckRow(row) {
    return {
        productVersion: String(row.product_version ?? ""),
        osClaim: row.os_claim === null ? null : String(row.os_claim),
        downloadCount: Number(row.download_count ?? 0),
        firstAcknowledgedAt: new Date(row.first_acknowledged_at).toISOString(),
        lastAcknowledgedAt: new Date(row.last_acknowledged_at).toISOString(),
        lastDownloadedAt: row.last_downloaded_at ? new Date(row.last_downloaded_at).toISOString() : null,
    };
}
function toInstalledRow(row) {
    return {
        deviceId: String(row.device_id ?? ""),
        deviceName: row.device_name === null ? null : String(row.device_name),
        osEdition: row.os_edition === null ? null : String(row.os_edition),
        osBuild: row.os_build === null ? null : Number(row.os_build),
        osUbr: row.os_ubr === null ? null : Number(row.os_ubr),
        appVersion: row.app_version === null ? null : String(row.app_version),
        reportedAt: new Date(row.reported_at).toISOString(),
    };
}
