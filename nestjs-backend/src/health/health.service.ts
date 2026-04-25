import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";

interface ServiceState {
	status: "up" | "down";
	changedAt: string;
	lastCheckedAt: string | null;
	lastDowntimeAt: string | null;
	lastRecoveryAt: string | null;
	lastError: string | null;
}

@Injectable()
export class HealthService {
	private readonly aiHealthHost: string;
	private readonly adminHealthUrl: string;

	private readonly serviceHealthState: Record<string, ServiceState> = {
		backend: {
			status: "up",
			changedAt: new Date().toISOString(),
			lastCheckedAt: null,
			lastDowntimeAt: null,
			lastRecoveryAt: new Date().toISOString(),
			lastError: null,
		},
		database: {
			status: "up",
			changedAt: new Date().toISOString(),
			lastCheckedAt: null,
			lastDowntimeAt: null,
			lastRecoveryAt: new Date().toISOString(),
			lastError: null,
		},
		ai: {
			status: "up",
			changedAt: new Date().toISOString(),
			lastCheckedAt: null,
			lastDowntimeAt: null,
			lastRecoveryAt: new Date().toISOString(),
			lastError: null,
		},
		administration: {
			status: "up",
			changedAt: new Date().toISOString(),
			lastCheckedAt: null,
			lastDowntimeAt: null,
			lastRecoveryAt: new Date().toISOString(),
			lastError: null,
		},
	};

	constructor(
		private readonly configService: ConfigService,
		private readonly databaseService: DatabaseService,
	) {
		this.aiHealthHost = String(this.configService.get<string>("health.aiHealthHost") || "").trim() || "http://localhost:5000";
		this.adminHealthUrl = String(this.configService.get<string>("health.adminHealthUrl") || "").trim();
	}

	getLiveness(requestId?: string) {
		return {
			status: "ok",
			timestamp: new Date().toISOString(),
			requestId,
		};
	}

	private applyServiceHealth(
		serviceName: keyof typeof this.serviceHealthState,
		isUp: boolean,
		errorMessage: string | null,
	): void {
		const nowIso = new Date().toISOString();
		const serviceState = this.serviceHealthState[serviceName];

		const nextStatus = isUp ? "up" : "down";
		if (serviceState.status !== nextStatus) {
			serviceState.status = nextStatus;
			serviceState.changedAt = nowIso;
			if (nextStatus === "down") {
				serviceState.lastDowntimeAt = nowIso;
			} else {
				serviceState.lastRecoveryAt = nowIso;
			}
		}

		serviceState.lastCheckedAt = nowIso;
		serviceState.lastError = errorMessage;
	}

	private async checkAiHealth(): Promise<{ isUp: boolean; error: string | null }> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 3500);

		try {
			const response = await fetch(`${this.aiHealthHost}/api/health`, {
				method: "GET",
				signal: controller.signal,
				headers: { Accept: "application/json" },
			});

			if (!response.ok) {
				return { isUp: false, error: `AI health returned ${response.status}` };
			}

			return { isUp: true, error: null };
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				return { isUp: false, error: "AI health check timed out" };
			}
			const detail = error instanceof Error ? error.message : String(error);
			return { isUp: false, error: detail || "AI health check failed" };
		} finally {
			clearTimeout(timeout);
		}
	}

	private async checkAdministrationHealth(canRunAdmin: boolean): Promise<{ isUp: boolean; error: string | null }> {
		if (!canRunAdmin) {
			return { isUp: false, error: "Administration service is unavailable because backend/database is down" };
		}

		if (!this.adminHealthUrl) {
			return { isUp: true, error: null };
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 3500);

		try {
			const response = await fetch(this.adminHealthUrl, {
				method: "GET",
				signal: controller.signal,
				headers: { Accept: "application/json" },
			});

			if (!response.ok) {
				return { isUp: false, error: `Administration health returned ${response.status}` };
			}

			return { isUp: true, error: null };
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				return { isUp: false, error: "Administration health check timed out" };
			}
			const detail = error instanceof Error ? error.message : String(error);
			return { isUp: false, error: detail || "Administration health check failed" };
		} finally {
			clearTimeout(timeout);
		}
	}

	async getServicesHealth(requestId?: string) {
		const checkedAt = new Date().toISOString();
		const dbHealth = await this.databaseService.checkHealth();
		const aiHealth = await this.checkAiHealth();
		const backendIsUp = dbHealth.isUp;
		const backendError = backendIsUp ? null : "Backend service is unavailable because database is down";
		const adminHealth = await this.checkAdministrationHealth(backendIsUp);

		this.applyServiceHealth("backend", backendIsUp, backendError);
		this.applyServiceHealth("database", dbHealth.isUp, dbHealth.error);
		this.applyServiceHealth("ai", aiHealth.isUp, aiHealth.error);
		this.applyServiceHealth("administration", adminHealth.isUp, adminHealth.error);

		const services = {
			backend: { ...this.serviceHealthState.backend, displayName: "Server-side API" },
			database: { ...this.serviceHealthState.database, displayName: "PostgreSQL Database" },
			ai: { ...this.serviceHealthState.ai, displayName: "AI Model Services" },
			administration: { ...this.serviceHealthState.administration, displayName: "Administration Console" },
		};

		const upCount = Object.values(services).filter((service) => service.status === "up").length;

		return {
			status: "ok",
			checkedAt,
			strictDbOnlyMetrics: this.configService.get<string>("SERVICE_METRICS_STRICT_DB_ONLY") === "true",
			summary: {
				totalServices: Object.keys(services).length,
				upServices: upCount,
				downServices: Object.keys(services).length - upCount,
			},
			services,
			requestId,
		};
	}
}
