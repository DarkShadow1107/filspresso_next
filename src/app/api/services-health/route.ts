import { NextResponse } from "next/server";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const STRICT_DB_ONLY_METRICS = process.env.SERVICE_METRICS_STRICT_DB_ONLY === "true";
const LOGS_DIR = path.join(process.cwd(), "logs");
const INCIDENT_BUFFER_FILE = path.join(LOGS_DIR, "services-incidents-buffer.log");
const STATE_FILE = path.join(LOGS_DIR, "services-status-state.log");
let inMemoryState: ServiceStateSnapshot | null = null;

type ServiceStatus = "up" | "down";

type ServiceInfo = {
	displayName: string;
	status: ServiceStatus;
	changedAt: string | null;
	lastCheckedAt: string | null;
	lastDowntimeAt: string | null;
	lastRecoveryAt: string | null;
	lastError: string | null;
};

type ServiceIncident = {
	service_key: string;
	service_name: string;
	status: ServiceStatus;
	reason: string | null;
	occurred_at: string;
	source: "next-api" | "backend";
};

type ServiceStateSnapshot = {
	checkedAt: string;
	services: Record<
		string,
		{
			status: ServiceStatus;
			displayName: string;
		}
	>;
};

type ServicesPayload = {
	status: string;
	checkedAt: string;
	strictDbOnlyMetrics?: boolean;
	summary: {
		totalServices: number;
		upServices: number;
		downServices: number;
	};
	services: Record<string, ServiceInfo>;
	incidents?: ServiceIncident[];
};

function createBackendDownFallbackPayload(reason?: string): ServicesPayload {
	const nowIso = new Date().toISOString();
	const inheritedAiStatus = inMemoryState?.services?.ai?.status || "up";
	const inheritedDbStatus = inMemoryState?.services?.database?.status || "down";
	const inheritedAiError = inheritedAiStatus === "down" ? "AI service is currently unavailable" : null;
	const inheritedDbError = inheritedDbStatus === "down" ? "Database status unavailable while backend is down" : null;

	const services: Record<string, ServiceInfo> = {
		backend: {
			displayName: "Server-side API",
			status: "down" as ServiceStatus,
			changedAt: nowIso,
			lastCheckedAt: nowIso,
			lastDowntimeAt: nowIso,
			lastRecoveryAt: null,
			lastError: reason || "Backend service is unreachable",
		},
		database: {
			displayName: "PostgreSQL Database",
			status: inheritedDbStatus,
			changedAt: nowIso,
			lastCheckedAt: nowIso,
			lastDowntimeAt: inheritedDbStatus === "down" ? nowIso : null,
			lastRecoveryAt: inheritedDbStatus === "up" ? nowIso : null,
			lastError: inheritedDbError,
		},
		ai: {
			displayName: "AI Model Services",
			status: inheritedAiStatus,
			changedAt: nowIso,
			lastCheckedAt: nowIso,
			lastDowntimeAt: inheritedAiStatus === "down" ? nowIso : null,
			lastRecoveryAt: inheritedAiStatus === "up" ? nowIso : null,
			lastError: inheritedAiError,
		},
		administration: {
			displayName: "Administration Console",
			status: "down" as ServiceStatus,
			changedAt: nowIso,
			lastCheckedAt: nowIso,
			lastDowntimeAt: nowIso,
			lastRecoveryAt: null,
			lastError: "Administration status unavailable while backend is down",
		},
	};

	const upCount = Object.values(services).filter((service) => service.status === "up").length;

	return {
		status: "degraded",
		checkedAt: nowIso,
		summary: {
			totalServices: 4,
			upServices: upCount,
			downServices: 4 - upCount,
		},
		services,
	};
}

async function createDatabaseOnlyFallbackPayload(reason: string): Promise<ServicesPayload> {
	const nowIso = new Date().toISOString();
	const previous = await loadPreviousState();
	const previousAi = previous?.services?.ai?.status;

	const payload: ServicesPayload = {
		status: "degraded",
		checkedAt: nowIso,
		summary: {
			totalServices: 4,
			upServices: 1,
			downServices: 3,
		},
		services: {
			backend: {
				displayName: "Server-side API",
				status: "down",
				changedAt: nowIso,
				lastCheckedAt: nowIso,
				lastDowntimeAt: nowIso,
				lastRecoveryAt: null,
				lastError: "Backend service is unavailable because database is down",
			},
			database: {
				displayName: "PostgreSQL Database",
				status: "down",
				changedAt: nowIso,
				lastCheckedAt: nowIso,
				lastDowntimeAt: nowIso,
				lastRecoveryAt: null,
				lastError: reason,
			},
			ai: {
				displayName: "AI Model Services",
				status: previousAi === "down" ? "down" : "up",
				changedAt: nowIso,
				lastCheckedAt: nowIso,
				lastDowntimeAt: previousAi === "down" ? nowIso : null,
				lastRecoveryAt: previousAi === "down" ? null : nowIso,
				lastError: previousAi === "down" ? "AI status unavailable during degraded backend checks" : null,
			},
			administration: {
				displayName: "Administration Console",
				status: "down",
				changedAt: nowIso,
				lastCheckedAt: nowIso,
				lastDowntimeAt: nowIso,
				lastRecoveryAt: null,
				lastError: "Administration service is unavailable because backend/database is down",
			},
		},
	};

	const upCount = Object.values(payload.services).filter((service) => service.status === "up").length;
	payload.summary.upServices = upCount;
	payload.summary.downServices = payload.summary.totalServices - upCount;

	return payload;
}

async function ensureLogsDir() {
	await mkdir(LOGS_DIR, { recursive: true });
}

async function loadPreviousState(): Promise<ServiceStateSnapshot | null> {
	if (inMemoryState) return inMemoryState;

	try {
		const raw = await readFile(STATE_FILE, "utf-8");
		const lines = raw
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);

		if (lines.length === 0) return null;

		const parsed = JSON.parse(lines[lines.length - 1]) as ServiceStateSnapshot;
		if (!parsed?.services || typeof parsed.services !== "object") return null;
		inMemoryState = parsed;
		return parsed;
	} catch {
		try {
			const legacyRaw = await readFile(path.join(LOGS_DIR, "services-status-state.json"), "utf-8");
			const parsed = JSON.parse(legacyRaw) as ServiceStateSnapshot;
			if (!parsed?.services || typeof parsed.services !== "object") return null;
			inMemoryState = parsed;
			return parsed;
		} catch {
			return null;
		}
	}
}

function toSnapshot(payload: ServicesPayload): ServiceStateSnapshot {
	return {
		checkedAt: payload.checkedAt,
		services: Object.fromEntries(
			Object.entries(payload.services || {}).map(([serviceKey, service]) => [
				serviceKey,
				{ status: service.status, displayName: service.displayName },
			]),
		),
	};
}

async function saveStateToLog(snapshot: ServiceStateSnapshot) {
	await ensureLogsDir();
	await writeFile(STATE_FILE, `${JSON.stringify(snapshot)}\n`, { encoding: "utf-8", flag: "a" });
}

async function updateState(payload: ServicesPayload, persistToLog: boolean) {
	const snapshot: ServiceStateSnapshot = {
		...toSnapshot(payload),
	};
	inMemoryState = snapshot;

	if (persistToLog) {
		await saveStateToLog(snapshot);
	}
}

function buildIncidents(previous: ServiceStateSnapshot | null, payload: ServicesPayload): ServiceIncident[] {
	if (!previous?.services) return [];

	const incidents: ServiceIncident[] = [];
	for (const [serviceKey, service] of Object.entries(payload.services || {})) {
		const previousStatus = previous.services[serviceKey]?.status;
		if (!previousStatus || previousStatus === service.status) continue;

		incidents.push({
			service_key: serviceKey,
			service_name: service.displayName,
			status: service.status,
			reason: service.lastError,
			occurred_at: service.changedAt || payload.checkedAt,
			source: "next-api",
		});
	}

	return incidents;
}

async function appendBufferedIncidents(events: ServiceIncident[]) {
	if (events.length === 0) return;
	await ensureLogsDir();
	const nextChunk = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
	await writeFile(INCIDENT_BUFFER_FILE, nextChunk, { encoding: "utf-8", flag: "a" });
}

async function loadBufferedIncidents(): Promise<ServiceIncident[]> {
	try {
		const content = await readFile(INCIDENT_BUFFER_FILE, "utf-8");
		const lines = content.split("\n").map((line) => line.trim());
		return lines
			.filter((line) => line.length > 0)
			.map((line) => {
				const parsed = JSON.parse(line) as ServiceIncident;
				return parsed;
			});
	} catch {
		return [];
	}
}

async function clearBufferedIncidents() {
	try {
		await rm(INCIDENT_BUFFER_FILE, { force: true });
	} catch {
		// noop
	}
}

async function clearRecoveryLogs() {
	try {
		await rm(INCIDENT_BUFFER_FILE, { force: true });
		await rm(STATE_FILE, { force: true });
		await rm(path.join(LOGS_DIR, "services-status-state.json"), { force: true });
	} catch {
		// noop
	}
}

async function persistIncidents(events: ServiceIncident[]) {
	if (events.length === 0) return;

	const response = await fetch(`${API_BASE}/health/services/events/bulk`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ events }),
		cache: "no-store",
	});

	if (!response.ok) {
		throw new Error(`Failed to persist incidents (${response.status})`);
	}
}

async function replayBufferedIncidents() {
	const buffered = await loadBufferedIncidents();
	if (buffered.length === 0) return;

	await persistIncidents(buffered);
	await clearRecoveryLogs();
}

async function loadIncidentHistory(windowHours: number, limit = 120, allowLogFallback = true): Promise<ServiceIncident[]> {
	const clampedWindowHours = Math.min(Math.max(windowHours, 1), 24 * 365);
	try {
		const response = await fetch(`${API_BASE}/health/services/events?limit=${limit}&windowHours=${clampedWindowHours}`, {
			cache: "no-store",
			headers: { Accept: "application/json" },
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch incident history (${response.status})`);
		}

		const payload = (await response.json()) as { incidents?: ServiceIncident[] };
		if (!Array.isArray(payload.incidents)) return [];
		return payload.incidents;
	} catch {
		if (!allowLogFallback) return [];
		const buffered = await loadBufferedIncidents();
		const cutoffMs = Date.now() - clampedWindowHours * 60 * 60 * 1000;
		return buffered
			.filter((incident) => new Date(incident.occurred_at).getTime() >= cutoffMs)
			.slice(-limit)
			.reverse();
	}
}

function withIncidents(payload: ServicesPayload, incidents: ServiceIncident[]) {
	return {
		...payload,
		incidents,
	};
}

export async function GET(request: Request) {
	try {
		const url = new URL(request.url);
		const rawWindowHours = Number.parseInt(url.searchParams.get("windowHours") || "24", 10);
		const windowHours = Number.isFinite(rawWindowHours) ? Math.min(Math.max(rawWindowHours, 1), 24 * 365) : 24;

		if (STRICT_DB_ONLY_METRICS) {
			const previous = inMemoryState;
			const response = await fetch(`${API_BASE}/health/services`, {
				method: "GET",
				headers: { Accept: "application/json" },
				cache: "no-store",
			});

			if (!response.ok) {
				return NextResponse.json(
					{
						error: "Strict DB-only metrics mode enabled. Live backend service metrics are unavailable.",
						strictDbOnlyMetrics: true,
						checkedAt: new Date().toISOString(),
					},
					{ status: 503 },
				);
			}

			const livePayload = (await response.json()) as ServicesPayload;
			const incidents = buildIncidents(previous, livePayload);

			try {
				await persistIncidents(incidents);
			} catch {
				// Strict mode intentionally avoids local fallback persistence.
			}

			await updateState(livePayload, false);
			const history = await loadIncidentHistory(windowHours, 1000, false);
			return NextResponse.json(withIncidents(livePayload, history), { status: response.status });
		}

		await ensureLogsDir();
		const previous = await loadPreviousState();

		const response = await fetch(`${API_BASE}/health/services`, {
			method: "GET",
			headers: { Accept: "application/json" },
			cache: "no-store",
		});

		if (!response.ok) {
			const healthProbe = await fetch(`${API_BASE}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				cache: "no-store",
			}).catch(() => null);

			const payload: ServicesPayload = healthProbe?.ok
				? await createDatabaseOnlyFallbackPayload(
						`Database status unavailable (services endpoint returned ${response.status})`,
					)
				: createBackendDownFallbackPayload(`Backend health endpoint returned ${response.status}`);

			const incidents = buildIncidents(previous, payload);
			let persistedToBuffer = false;
			try {
				await replayBufferedIncidents();
				await persistIncidents(incidents);
			} catch {
				await appendBufferedIncidents(incidents);
				persistedToBuffer = true;
			}

			await updateState(payload, true);
			const history = await loadIncidentHistory(windowHours, 1000);

			return NextResponse.json(withIncidents(payload, history), { status: 200 });
		}

		const livePayload = (await response.json()) as ServicesPayload;
		const strictModeEnabled = STRICT_DB_ONLY_METRICS || livePayload.strictDbOnlyMetrics === true;
		const incidents = buildIncidents(previous, livePayload);
		let persistedToBuffer = false;

		if (strictModeEnabled) {
			try {
				await persistIncidents(incidents);
			} catch {
				// strict mode does not use local fallback buffering
			}
		} else {
			try {
				await replayBufferedIncidents();
				await persistIncidents(incidents);
				await clearRecoveryLogs();
			} catch {
				await appendBufferedIncidents(incidents);
				persistedToBuffer = true;
			}
		}

		await updateState(livePayload, !strictModeEnabled && persistedToBuffer);
		const history = await loadIncidentHistory(windowHours, 1000, !strictModeEnabled);
		return NextResponse.json(withIncidents(livePayload, history), { status: response.status });
	} catch {
		try {
			await ensureLogsDir();
			const previous = await loadPreviousState();
			const payload = createBackendDownFallbackPayload();
			const incidents = buildIncidents(previous, payload);
			await appendBufferedIncidents(incidents);
			await updateState(payload, true);
			const history = await loadBufferedIncidents();
			return NextResponse.json(withIncidents(payload, history.slice(-200).reverse()), { status: 200 });
		} catch {
			return NextResponse.json(createBackendDownFallbackPayload(), { status: 200 });
		}
	}
}
