import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { execFile } from "node:child_process";
import type { Pool, PoolClient } from "pg";
import { resolveExpressApiPath } from "../common/utils/legacy-paths";
import * as securityLedger from "../common/utils/securityLedger";
import { DatabaseService } from "../database/database.service";

interface SecurityMetrics {
	policyDenials: number;
	zkPendingVerifications: number;
	zkVerificationFailures: number;
	mpcStalledSessions: number;
	mpcReadyBacklog: number;
	mpcQuorumFailures: number;
	thresholdExpired: number;
}

interface SnapshotOptions {
	windowMinutes?: number;
	mpcStaleMinutes?: number;
}

interface DispatchOptions {
	minSeverity?: string;
	force?: boolean;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	const normalized = String(value).trim().toLowerCase();
	if (normalized === "true" || normalized === "1") return true;
	if (normalized === "false" || normalized === "0") return false;
	return fallback;
}

function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(parsed, min), max);
}

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

@Injectable()
export class SecurityObservabilityService {
	private readonly logger = new Logger(SecurityObservabilityService.name);
	private readonly pool: Pool;
	private readonly appendSecurityLedgerEvent = securityLedger.appendSecurityLedgerEvent;
	private readonly verifySecurityLedgerChain = securityLedger.verifySecurityLedgerChain;

	private readonly incidentRetentionDays = parseBoundedInt(process.env.SERVICE_INCIDENT_RETENTION_DAYS, 180, 30, 3650);
	private readonly retentionJobIntervalMs = parseBoundedInt(
		process.env.SERVICE_INCIDENT_RETENTION_JOB_MS,
		6 * 60 * 60 * 1000,
		60 * 60 * 1000,
		24 * 60 * 60 * 1000,
	);

	private readonly securityObservabilityDefaultWindowMinutes = parseBoundedInt(
		process.env.SECURITY_OBSERVABILITY_WINDOW_MINUTES,
		60,
		5,
		24 * 60,
	);
	private readonly securityObservabilityDefaultMpcStaleMinutes = parseBoundedInt(
		process.env.SECURITY_OBSERVABILITY_MPC_STALE_MINUTES,
		30,
		5,
		24 * 60,
	);

	private readonly securityLedgerArchiveEnabled = parseBoolean(process.env.SECURITY_LEDGER_ARCHIVE_ENABLED, true);
	private readonly securityLedgerArchiveIntervalMs = parseBoundedInt(
		process.env.SECURITY_LEDGER_ARCHIVE_INTERVAL_MS,
		60 * 60 * 1000,
		15 * 60 * 1000,
		24 * 60 * 60 * 1000,
	);
	private readonly securityLedgerArchiveOlderThanHours = parseBoundedInt(
		process.env.SECURITY_ARCHIVE_OLDER_THAN_HOURS,
		24,
		1,
		24 * 365,
	);
	private readonly securityLedgerArchiveLimit = parseBoundedInt(process.env.SECURITY_ARCHIVE_LIMIT, 500, 1, 5000);
	private readonly securityLedgerArchiveChainScope = String(process.env.SECURITY_ARCHIVE_CHAIN_SCOPE || "").trim();

	private readonly securityAlertWebhookUrl = String(process.env.SECURITY_ALERT_WEBHOOK_URL || "").trim();
	private readonly securityAlertWebhookTimeoutMs = parseBoundedInt(
		process.env.SECURITY_ALERT_WEBHOOK_TIMEOUT_MS,
		4000,
		1000,
		30000,
	);
	private readonly securityAlertDispatchMinSeverity =
		String(process.env.SECURITY_ALERT_DISPATCH_MIN_SEVERITY || "high")
			.trim()
			.toLowerCase() || "high";

	private securityArchiveJobRunning = false;

	constructor(private readonly databaseService: DatabaseService) {
		this.pool = this.databaseService.getPool();
	}

	getRetentionJobIntervalMs(): number {
		return this.retentionJobIntervalMs;
	}

	isArchiveSchedulerEnabled(): boolean {
		return this.securityLedgerArchiveEnabled;
	}

	getArchiveSchedulerIntervalMs(): number {
		return this.securityLedgerArchiveIntervalMs;
	}

	async pruneOldServiceIncidents(): Promise<void> {
		let client: PoolClient | undefined;
		try {
			client = await this.pool.connect();
			const result = await client.query(
				`DELETE FROM service_health_incidents
         WHERE occurred_at < (NOW() - ($1::int * INTERVAL '1 day'))`,
				[this.incidentRetentionDays],
			);

			if (result.rowCount && result.rowCount > 0) {
				this.logger.log(
					`Retention cleanup removed ${result.rowCount} incidents older than ${this.incidentRetentionDays} days`,
				);
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.logger.error(`Retention cleanup failed: ${detail}`);
		} finally {
			client?.release();
		}
	}

	async runSecurityLedgerArchiveJob(): Promise<void> {
		if (!this.securityLedgerArchiveEnabled || this.securityArchiveJobRunning) {
			return;
		}

		this.securityArchiveJobRunning = true;
		const args = [
			resolveExpressApiPath("scripts", "archive_security_ledger.js"),
			`--older-than-hours=${this.securityLedgerArchiveOlderThanHours}`,
			`--limit=${this.securityLedgerArchiveLimit}`,
		];
		if (this.securityLedgerArchiveChainScope) {
			args.push(`--chain-scope=${this.securityLedgerArchiveChainScope}`);
		}

		try {
			await new Promise<void>((resolve, reject) => {
				execFile(process.execPath, args, { cwd: resolveExpressApiPath(), env: process.env }, (error, stdout, stderr) => {
					if (error) {
						const detail = String(stderr || error.message || "").trim();
						reject(new Error(detail || "security ledger archive job failed"));
						return;
					}

					const output = String(stdout || "").trim();
					if (output) {
						this.logger.log(`Security ledger archive job: ${output}`);
					}
					resolve();
				});
			});
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.logger.error(`Security ledger archive scheduler failed: ${detail}`);
		} finally {
			this.securityArchiveJobRunning = false;
		}
	}

	private getSecuritySeverity(metrics: SecurityMetrics): "low" | "medium" | "high" | "critical" {
		if ((metrics.zkVerificationFailures || 0) >= 3 || (metrics.mpcStalledSessions || 0) >= 3) return "critical";
		if (
			(metrics.policyDenials || 0) >= 10 ||
			(metrics.zkPendingVerifications || 0) >= 10 ||
			(metrics.thresholdExpired || 0) >= 2
		) {
			return "high";
		}
		if ((metrics.policyDenials || 0) >= 3 || (metrics.mpcReadyBacklog || 0) >= 1) return "medium";
		return "low";
	}

	private securitySeverityRank(severity: string): number {
		const normalized = String(severity || "low")
			.trim()
			.toLowerCase();
		const rank: Record<string, number> = {
			low: 1,
			medium: 2,
			high: 3,
			critical: 4,
		};
		return rank[normalized] || rank.low;
	}

	private async dispatchSecurityAlertWebhook(
		payload: Record<string, unknown>,
		options: DispatchOptions = {},
	): Promise<Record<string, unknown>> {
		if (!this.securityAlertWebhookUrl) {
			return { dispatched: false, reason: "webhook_not_configured" };
		}

		const minSeverity = String(options.minSeverity || this.securityAlertDispatchMinSeverity)
			.trim()
			.toLowerCase();
		const eventSeverity = String(payload.severity || "low")
			.trim()
			.toLowerCase();
		const force = Boolean(options.force);

		if (!force && this.securitySeverityRank(eventSeverity) < this.securitySeverityRank(minSeverity)) {
			return {
				dispatched: false,
				reason: "below_min_severity",
				minSeverity,
				eventSeverity,
			};
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.securityAlertWebhookTimeoutMs);

		try {
			const response = await fetch(this.securityAlertWebhookUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			if (!response.ok) {
				const body = await response.text().catch(() => "");
				return {
					dispatched: false,
					reason: "webhook_rejected",
					status: response.status,
					details: body || null,
				};
			}

			return {
				dispatched: true,
				status: response.status,
				target: this.securityAlertWebhookUrl,
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return {
				dispatched: false,
				reason: "webhook_error",
				details: detail,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	async collectSecurityObservabilitySnapshot(options: SnapshotOptions = {}): Promise<Record<string, unknown>> {
		const windowMinutes = Number.isFinite(options.windowMinutes)
			? Math.min(Math.max(options.windowMinutes || this.securityObservabilityDefaultWindowMinutes, 5), 24 * 60)
			: this.securityObservabilityDefaultWindowMinutes;
		const mpcStaleMinutes = Number.isFinite(options.mpcStaleMinutes)
			? Math.min(Math.max(options.mpcStaleMinutes || this.securityObservabilityDefaultMpcStaleMinutes, 5), 24 * 60)
			: this.securityObservabilityDefaultMpcStaleMinutes;

		const client = await this.pool.connect();
		try {
			const policyDenialsResult = await client.query(
				`SELECT COUNT(*)::int AS count
         FROM security_event_ledger
         WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 minute')
           AND (
            event_type ILIKE 'policy.%deny%'
            OR event_type ILIKE 'auth.%deny%'
            OR event_type ILIKE 'opa.%deny%'
           )`,
				[windowMinutes],
			);

			const zkFailuresResult = await client.query(
				`SELECT
          COUNT(*) FILTER (WHERE verified = FALSE)::int AS pending_or_failed,
          COUNT(*) FILTER (WHERE verified = FALSE AND created_at <= NOW() - INTERVAL '15 minutes')::int AS stale_failures
         FROM zk_proof_sessions
         WHERE created_at >= NOW() - ($1::int * INTERVAL '1 minute')`,
				[windowMinutes],
			);

			const mpcResult = await client.query(
				`SELECT
          COUNT(*) FILTER (WHERE status IN ('pending', 'ready') AND created_at <= NOW() - ($1::int * INTERVAL '1 minute'))::int AS stalled,
          COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_backlog,
          COUNT(*) FILTER (WHERE status IN ('cancelled', 'expired') AND created_at >= NOW() - ($2::int * INTERVAL '1 minute'))::int AS quorum_failures
         FROM mpc_quorum_sessions`,
				[mpcStaleMinutes, windowMinutes],
			);

			const thresholdResult = await client.query(
				`SELECT COUNT(*)::int AS expired
         FROM threshold_operations
         WHERE status IN ('expired', 'rejected')
           AND updated_at >= NOW() - ($1::int * INTERVAL '1 minute')`,
				[windowMinutes],
			);

			const archiveResult = await client.query(
				`SELECT
          COUNT(*)::int AS archived_rows_window,
          MAX(archived_at) AS last_archived_at
         FROM security_event_ledger_archive
         WHERE archived_at >= NOW() - ($1::int * INTERVAL '1 minute')`,
				[windowMinutes],
			);

			const pendingArchiveResult = await client.query(
				`SELECT COUNT(*)::int AS pending_archive_rows
         FROM security_event_ledger l
         LEFT JOIN security_event_ledger_archive a ON a.original_id = l.id
         WHERE a.id IS NULL
           AND l.occurred_at <= NOW() - ($1::int * INTERVAL '1 hour')`,
				[this.securityLedgerArchiveOlderThanHours],
			);

			const policyDenyTrend = await client.query(
				`SELECT date_trunc('hour', occurred_at) AS bucket, COUNT(*)::int AS count
         FROM security_event_ledger
         WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 minute')
           AND (
            event_type ILIKE 'policy.%deny%'
            OR event_type ILIKE 'auth.%deny%'
            OR event_type ILIKE 'opa.%deny%'
           )
         GROUP BY bucket
         ORDER BY bucket ASC`,
				[windowMinutes],
			);

			const metrics: SecurityMetrics = {
				policyDenials: Number(policyDenialsResult.rows[0]?.count || 0),
				zkPendingVerifications: Number(zkFailuresResult.rows[0]?.pending_or_failed || 0),
				zkVerificationFailures: Number(zkFailuresResult.rows[0]?.stale_failures || 0),
				mpcStalledSessions: Number(mpcResult.rows[0]?.stalled || 0),
				mpcReadyBacklog: Number(mpcResult.rows[0]?.ready_backlog || 0),
				mpcQuorumFailures: Number(mpcResult.rows[0]?.quorum_failures || 0),
				thresholdExpired: Number(thresholdResult.rows[0]?.expired || 0),
			};

			return {
				generatedAt: new Date().toISOString(),
				windowMinutes,
				mpcStaleMinutes,
				severity: this.getSecuritySeverity(metrics),
				metrics,
				archive: {
					archivedRowsWindow: Number(archiveResult.rows[0]?.archived_rows_window || 0),
					pendingArchiveRows: Number(pendingArchiveResult.rows[0]?.pending_archive_rows || 0),
					lastArchivedAt: archiveResult.rows[0]?.last_archived_at || null,
				},
				trends: {
					policyDenialsPerHour: policyDenyTrend.rows.map((row) => ({
						bucket: row.bucket,
						count: Number(row.count || 0),
					})),
				},
			};
		} finally {
			client.release();
		}
	}

	async getSecurityAlerts(requestId?: string): Promise<Record<string, unknown>> {
		try {
			const snapshot = await this.collectSecurityObservabilitySnapshot({
				windowMinutes: this.securityObservabilityDefaultWindowMinutes,
				mpcStaleMinutes: this.securityObservabilityDefaultMpcStaleMinutes,
			});
			const severity = String(snapshot.severity || "low");
			const activeAlert = ["critical", "high"].includes(severity);
			return {
				generatedAt: snapshot.generatedAt,
				activeAlert,
				severity,
				metrics: snapshot.metrics,
				requestId,
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new ServiceUnavailableException({
				error: "Security alert evaluation unavailable",
				details: detail,
				requestId,
			});
		}
	}

	async dispatchSecurityAlert(body: Record<string, unknown>, requestId?: string): Promise<Record<string, unknown>> {
		const force =
			String(body.force || "false")
				.trim()
				.toLowerCase() === "true";
		const minSeverity = String(body.minSeverity || this.securityAlertDispatchMinSeverity)
			.trim()
			.toLowerCase();

		const windowMinutesRaw = Number.parseInt(
			String(body.windowMinutes || this.securityObservabilityDefaultWindowMinutes),
			10,
		);
		const mpcStaleMinutesRaw = Number.parseInt(
			String(body.mpcStaleMinutes || this.securityObservabilityDefaultMpcStaleMinutes),
			10,
		);

		const windowMinutes = Number.isFinite(windowMinutesRaw)
			? Math.min(Math.max(windowMinutesRaw, 5), 24 * 60)
			: this.securityObservabilityDefaultWindowMinutes;
		const mpcStaleMinutes = Number.isFinite(mpcStaleMinutesRaw)
			? Math.min(Math.max(mpcStaleMinutesRaw, 5), 24 * 60)
			: this.securityObservabilityDefaultMpcStaleMinutes;

		try {
			const snapshot = await this.collectSecurityObservabilitySnapshot({
				windowMinutes,
				mpcStaleMinutes,
			});

			const dispatchPayload = {
				eventType: "titan.security.alert",
				generatedAt: snapshot.generatedAt,
				severity: snapshot.severity,
				metrics: snapshot.metrics,
				archive: snapshot.archive,
				windowMinutes,
				mpcStaleMinutes,
				source: "nestjs-backend",
			};

			const dispatchResult = await this.dispatchSecurityAlertWebhook(dispatchPayload, {
				minSeverity,
				force,
			});

			return {
				dispatch: dispatchResult,
				snapshot,
				requestId,
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new ServiceUnavailableException({
				error: "Security alert dispatch failed",
				details: detail,
				requestId,
			});
		}
	}

	async verifySecurityLedger(
		chainScope: string,
		maxRows: number,
		requestId?: string,
	): Promise<{ statusCode: number; payload: Record<string, unknown> }> {
		let client: PoolClient | undefined;
		try {
			client = await this.pool.connect();
			const verification = await this.verifySecurityLedgerChain(client, {
				chainScope,
				maxRows,
			});
			const statusCode = verification.ok ? 200 : 409;
			return {
				statusCode,
				payload: { ...verification, requestId },
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new ServiceUnavailableException({
				error: "Security ledger verification unavailable",
				details: detail,
				requestId,
			});
		} finally {
			client?.release();
		}
	}

	async ingestServiceEventsBulk(events: Array<Record<string, unknown>>, requestId?: string): Promise<Record<string, unknown>> {
		if (events.length === 0) {
			return { inserted: 0, requestId };
		}

		let client: PoolClient | undefined;
		try {
			client = await this.pool.connect();
			await client.query("BEGIN");

			let inserted = 0;
			for (const event of events) {
				const serviceKey = readTrimmedString(event.service_key);
				const serviceName = readTrimmedString(event.service_name);
				const eventStatus = event.status;
				const status = eventStatus === "down" ? "down" : eventStatus === "up" ? "up" : "";
				const reasonRaw = readTrimmedString(event.reason);
				const reason = reasonRaw.length > 0 ? reasonRaw : null;
				const sourceRaw = readTrimmedString(event.source);
				const source = sourceRaw.length > 0 ? sourceRaw : "next-api";
				const occurredAtInput = event.occurred_at;
				const occurredAt = new Date(
					typeof occurredAtInput === "string" || typeof occurredAtInput === "number" || occurredAtInput instanceof Date
						? occurredAtInput
						: Date.now(),
				);

				if (!serviceKey || !serviceName || !status || Number.isNaN(occurredAt.getTime())) {
					continue;
				}

				await client.query(
					`INSERT INTO service_health_incidents (service_key, service_name, status, reason, occurred_at, source)
           VALUES ($1, $2, $3, $4, $5, $6)`,
					[serviceKey, serviceName, status, reason, occurredAt.toISOString(), source],
				);

				await this.appendSecurityLedgerEvent(client, {
					chainScope: "service-health",
					eventType: `service_health.${status}`,
					serviceName,
					actorType: "service",
					actorId: source,
					correlationId: requestId,
					occurredAt: occurredAt.toISOString(),
					payload: {
						service_key: serviceKey,
						service_name: serviceName,
						status,
						reason,
						source,
						occurred_at: occurredAt.toISOString(),
					},
				});

				inserted += 1;
			}

			await client.query("COMMIT");
			return { inserted, requestId };
		} catch (error) {
			if (client) {
				await client.query("ROLLBACK");
			}
			const detail = error instanceof Error ? error.message : String(error);
			throw new ServiceUnavailableException({
				error: "Failed to persist service incidents",
				details: detail,
				requestId,
			});
		} finally {
			client?.release();
		}
	}

	async getServiceIncidentHistory(limit: number, windowHours: number, requestId?: string): Promise<Record<string, unknown>> {
		let client: PoolClient | undefined;
		try {
			client = await this.pool.connect();
			const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
			const result = await client.query(
				`WITH windowed AS (
          SELECT id, service_key, service_name, status, reason, occurred_at, source, created_at
          FROM service_health_incidents
          WHERE occurred_at >= $1
          ORDER BY occurred_at DESC
          LIMIT $2
        ), anchors AS (
          SELECT DISTINCT ON (service_key)
            id, service_key, service_name, status, reason, occurred_at, source, created_at
          FROM service_health_incidents
          WHERE occurred_at < $1
          ORDER BY service_key, occurred_at DESC
        )
        SELECT id, service_key, service_name, status, reason, occurred_at, source, created_at
        FROM (
          SELECT * FROM windowed
          UNION ALL
          SELECT * FROM anchors
        ) merged
        ORDER BY occurred_at DESC`,
				[sinceIso, limit],
			);

			return {
				incidents: result.rows,
				requestId,
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new ServiceUnavailableException({
				error: "Service incident history unavailable",
				details: detail,
				requestId,
			});
		} finally {
			client?.release();
		}
	}
}
