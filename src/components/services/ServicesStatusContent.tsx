"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import "../../styles/services-status.css";

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

type ServicesPayload = {
	checkedAt: string;
	summary: {
		totalServices: number;
		upServices: number;
		downServices: number;
	};
	services: Record<string, ServiceInfo>;
	incidents?: ServiceIncident[];
};

type TimelineSegment = {
	leftPct: number;
	widthPct: number;
	status: ServiceStatus;
};

type TimelineModel = {
	windowLabel: string;
	hasData: boolean;
	uptimePercent: number;
	segments: TimelineSegment[];
	downEvents: number;
	totalEvents: number;
	lastDownReason: string | null;
	lastDownAt: string | null;
	upMinutes: number;
	downMinutes: number;
	axisLabels: [string, string, string, string, string];
};

const REFRESH_MS = 10000;

const WINDOW_OPTIONS = [
	{ hours: 24, label: "24h" },
	{ hours: 24 * 7, label: "7d" },
	{ hours: 24 * 30, label: "30d" },
] as const;

type WindowHours = (typeof WINDOW_OPTIONS)[number]["hours"];

const SERVICE_LABELS: Record<string, string> = {
	backend: "Server-side API",
	database: "PostgreSQL Database",
	ai: "AI Model Services",
	administration: "Administration Console",
};

function formatDate(iso: string | null): string {
	if (!iso) return "-";
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return "-";
	return parsed.toLocaleString();
}

function normalizeServiceName(serviceKey: string, fallbackName: string): string {
	return SERVICE_LABELS[serviceKey] || fallbackName;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}

function formatMinutes(minutes: number): string {
	if (minutes <= 0) return "0m";
	const total = Math.round(minutes);
	const h = Math.floor(total / 60);
	const m = total % 60;
	if (h === 0) return `${m}m`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}

function getWindowLabel(windowHours: number): string {
	if (windowHours < 24) return `Last ${windowHours}h`;
	if (windowHours % 24 === 0) {
		const days = windowHours / 24;
		if (days === 1) return "Last 24 hours";
		return `Last ${days} days`;
	}
	return `Last ${windowHours} hours`;
}

function getAxisLabels(windowHours: number): [string, string, string, string, string] {
	if (windowHours === 24) return ["24h ago", "18h", "12h", "6h", "Now"];
	if (windowHours === 24 * 7) return ["7d ago", "5d", "3d", "1d", "Now"];
	if (windowHours === 24 * 30) return ["30d ago", "21d", "14d", "7d", "Now"];
	return [`${windowHours}h ago`, "75%", "50%", "25%", "Now"];
}

function buildTimelineModel(
	serviceIncidents: ServiceIncident[],
	currentStatus: ServiceStatus,
	checkedAtIso: string,
	windowHours: number,
): TimelineModel {
	const windowMs = windowHours * 60 * 60 * 1000;
	const checkedAt = new Date(checkedAtIso).getTime();
	const safeCheckedAt = Number.isFinite(checkedAt) ? checkedAt : Date.now();
	const cutoff = safeCheckedAt - windowMs;

	const events = serviceIncidents
		.map((incident) => ({ ...incident, atMs: new Date(incident.occurred_at).getTime() }))
		.filter((incident) => Number.isFinite(incident.atMs) && incident.atMs <= safeCheckedAt)
		.sort((a, b) => a.atMs - b.atMs);

	const inWindow = events.filter((event) => event.atMs > cutoff);
	if (inWindow.length === 0) {
		return {
			windowLabel: getWindowLabel(windowHours),
			hasData: false,
			uptimePercent: 0,
			segments: [],
			downEvents: 0,
			totalEvents: 0,
			lastDownReason: null,
			lastDownAt: null,
			upMinutes: 0,
			downMinutes: 0,
			axisLabels: getAxisLabels(windowHours),
		};
	}

	const beforeOrAtCutoff = events.filter((event) => event.atMs <= cutoff).sort((a, b) => b.atMs - a.atMs)[0];

	let statusAtCutoff: ServiceStatus = beforeOrAtCutoff ? beforeOrAtCutoff.status : currentStatus;
	if (!beforeOrAtCutoff) {
		for (let index = events.length - 1; index >= 0; index -= 1) {
			const event = events[index];
			if (event.atMs <= cutoff) {
				break;
			}
			statusAtCutoff = event.status === "up" ? "down" : "up";
		}
	}

	const segments: TimelineSegment[] = [];
	let cursor = cutoff;
	let activeStatus = statusAtCutoff;
	let upDuration = 0;

	for (const event of inWindow) {
		if (event.atMs <= cursor) {
			activeStatus = event.status;
			continue;
		}

		const duration = event.atMs - cursor;
		if (activeStatus === "up") {
			upDuration += duration;
		}

		segments.push({
			leftPct: ((cursor - cutoff) / windowMs) * 100,
			widthPct: (duration / windowMs) * 100,
			status: activeStatus,
		});

		cursor = event.atMs;
		activeStatus = event.status;
	}

	const finalDuration = Math.max(safeCheckedAt - cursor, 0);
	if (activeStatus === "up") {
		upDuration += finalDuration;
	}

	segments.push({
		leftPct: ((cursor - cutoff) / windowMs) * 100,
		widthPct: (finalDuration / windowMs) * 100,
		status: activeStatus,
	});

	const lastDownIncident = [...events].reverse().find((event) => event.status === "down") || null;

	return {
		windowLabel: getWindowLabel(windowHours),
		hasData: true,
		uptimePercent: Math.round(clamp((upDuration / windowMs) * 100, 0, 100)),
		segments: segments.map((segment) => ({
			leftPct: clamp(segment.leftPct, 0, 100),
			widthPct: clamp(segment.widthPct, 0.3, 100),
			status: segment.status,
		})),
		downEvents: inWindow.filter((event) => event.status === "down").length,
		totalEvents: inWindow.length,
		lastDownReason: lastDownIncident?.reason || null,
		lastDownAt: lastDownIncident ? lastDownIncident.occurred_at : null,
		upMinutes: upDuration / (60 * 1000),
		downMinutes: Math.max((windowMs - upDuration) / (60 * 1000), 0),
		axisLabels: getAxisLabels(windowHours),
	};
}

export default function ServicesStatusContent() {
	const [payload, setPayload] = useState<ServicesPayload | null>(null);
	const [incidents, setIncidents] = useState<ServiceIncident[]>([]);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [windowHours, setWindowHours] = useState<WindowHours>(24);

	useEffect(() => {
		let isMounted = true;
		let intervalId: ReturnType<typeof setInterval> | null = null;

		const refresh = async () => {
			try {
				const response = await fetch(`/api/services-health?windowHours=${windowHours}`, { cache: "no-store" });
				if (!response.ok) {
					throw new Error(`Services endpoint failed (${response.status})`);
				}

				const nextPayload = (await response.json()) as ServicesPayload;
				if (!isMounted) return;

				setPayload(nextPayload);
				setIncidents(Array.isArray(nextPayload.incidents) ? nextPayload.incidents : []);
				setErrorMessage(null);
			} catch (error) {
				if (!isMounted) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to fetch service status");
			}
		};

		refresh();
		intervalId = setInterval(refresh, REFRESH_MS);

		return () => {
			isMounted = false;
			if (intervalId) clearInterval(intervalId);
		};
	}, [windowHours]);

	const sortedServices = useMemo(() => {
		if (!payload?.services) return [] as Array<[string, ServiceInfo]>;
		const entries = Object.entries(payload.services);
		return entries.sort((a, b) => {
			if (a[1].status === b[1].status) return a[1].displayName.localeCompare(b[1].displayName);
			return a[1].status === "down" ? -1 : 1;
		});
	}, [payload]);

	const incidentsByService = useMemo(() => {
		const map = new Map<string, ServiceIncident[]>();
		for (const incident of incidents) {
			const list = map.get(incident.service_key) || [];
			list.push(incident);
			map.set(incident.service_key, list);
		}
		return map;
	}, [incidents]);

	const timelineByService = useMemo(() => {
		const map = new Map<string, TimelineModel>();
		for (const [serviceKey, service] of sortedServices) {
			const serviceIncidents = incidentsByService.get(serviceKey) || [];
			map.set(
				serviceKey,
				buildTimelineModel(serviceIncidents, service.status, payload?.checkedAt || new Date().toISOString(), windowHours),
			);
		}
		return map;
	}, [incidentsByService, payload?.checkedAt, sortedServices, windowHours]);

	return (
		<main className="services-status-page">
			<section className="services-hero">
				<div className="services-hero-inner">
					<p className="services-eyebrow">Infrastructure Overview</p>
					<h1>Filspresso Services</h1>
					<p>
						Live health for the Server-side API, PostgreSQL Database, AI Model Services, and Administration Console.
					</p>
				</div>
			</section>

			<section className="services-panel">
				<div className="services-summary-grid">
					<div className="services-summary-card">
						<span>Total Services</span>
						<strong>{payload?.summary.totalServices ?? 0}</strong>
					</div>
					<div className="services-summary-card up">
						<span>Up</span>
						<strong>{payload?.summary.upServices ?? 0}</strong>
					</div>
					<div className="services-summary-card down">
						<span>Down</span>
						<strong>{payload?.summary.downServices ?? 0}</strong>
					</div>
					<div className="services-summary-card">
						<span>Last Check</span>
						<strong>{formatDate(payload?.checkedAt ?? null)}</strong>
					</div>
				</div>

				{errorMessage && <p className="services-error">{errorMessage}</p>}

				<div className="services-table-wrap">
					<table className="services-table">
						<thead>
							<tr>
								<th>Service</th>
								<th>Status</th>
								<th>Last Changed</th>
								<th>Last Down</th>
								<th>Last Recovery</th>
								<th>Notes</th>
							</tr>
						</thead>
						<tbody>
							{sortedServices.map(([serviceKey, service]) => (
								<tr key={serviceKey}>
									<td>{normalizeServiceName(serviceKey, service.displayName)}</td>
									<td>
										<span className={`service-pill ${service.status}`}>{service.status.toUpperCase()}</span>
									</td>
									<td>{formatDate(service.changedAt)}</td>
									<td>{formatDate(service.lastDowntimeAt)}</td>
									<td>{formatDate(service.lastRecoveryAt)}</td>
									<td>{service.lastError || "Operational"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section className="services-graphs">
				<div className="services-history-header">
					<h2>Uptime Timeline</h2>
					<p>Availability from persisted incidents and current service state.</p>
				</div>

				<div className="services-window-switcher" role="group" aria-label="Timeline window selector">
					{WINDOW_OPTIONS.map((option) => (
						<button
							type="button"
							key={option.hours}
							onClick={() => setWindowHours(option.hours)}
							className={`services-window-btn ${windowHours === option.hours ? "active" : ""}`}
						>
							{option.label}
						</button>
					))}
				</div>

				<div className="services-graphs-grid">
					{sortedServices.map(([serviceKey, service]) => {
						const timeline = timelineByService.get(serviceKey);
						if (!timeline) return null;

						return (
							<article className="services-graph-card" key={`graph-${serviceKey}`}>
								<header>
									<h3>{normalizeServiceName(serviceKey, service.displayName)}</h3>
									<span className={`service-pill ${service.status}`}>{service.status.toUpperCase()}</span>
								</header>

								<div className="services-graph-topline">
									<div
										className="services-uptime-ring"
										style={{
											background: timeline.hasData
												? `conic-gradient(#63d39a ${timeline.uptimePercent * 3.6}deg, rgba(255,255,255,0.08) 0deg)`
												: "conic-gradient(rgba(255,255,255,0.12) 360deg, rgba(255,255,255,0.12) 0deg)",
										}}
									>
										<div>
											<strong>{timeline.hasData ? `${timeline.uptimePercent}%` : "--"}</strong>
											<span>uptime</span>
										</div>
									</div>
									<div className="services-kpi-grid">
										<div className="services-kpi-tile">
											<span>Up Time</span>
											<strong>{timeline.hasData ? formatMinutes(timeline.upMinutes) : "--"}</strong>
										</div>
										<div className="services-kpi-tile down">
											<span>Down Time</span>
											<strong>{timeline.hasData ? formatMinutes(timeline.downMinutes) : "--"}</strong>
										</div>
										<div className="services-kpi-tile">
											<span>Down Events</span>
											<strong>{timeline.hasData ? timeline.downEvents : "--"}</strong>
										</div>
										<div className="services-kpi-tile">
											<span>Transitions</span>
											<strong>{timeline.hasData ? timeline.totalEvents : "--"}</strong>
										</div>
									</div>
								</div>

								<div className="services-graph-wrap" role="img" aria-label="Service uptime timeline">
									{timeline.hasData ? (
										<>
											<div className="services-timeline-track">
												{timeline.segments.map((segment, index) => (
													<div
														key={`${serviceKey}-segment-${index}`}
														className={`services-timeline-segment ${segment.status}`}
														style={{ left: `${segment.leftPct}%`, width: `${segment.widthPct}%` }}
													/>
												))}
												<div className="services-timeline-now" />
											</div>
											<div className="services-timeline-axis">
												<span>{timeline.axisLabels[0]}</span>
												<span>{timeline.axisLabels[1]}</span>
												<span>{timeline.axisLabels[2]}</span>
												<span>{timeline.axisLabels[3]}</span>
												<span>{timeline.axisLabels[4]}</span>
											</div>
										</>
									) : (
										<div className="services-no-window-data">
											No incident data stored for this service in the selected window.
										</div>
									)}
								</div>

								<div className="services-graph-meta">
									<strong>{timeline.windowLabel}</strong>
									<span>
										{timeline.hasData
											? service.status === "up"
												? "Currently stable"
												: "Currently degraded"
											: "Waiting for DB incidents"}
									</span>
								</div>

								{timeline.lastDownReason && (
									<p className="services-incident-reason">
										Latest down reason ({formatDate(timeline.lastDownAt)}): {timeline.lastDownReason}
									</p>
								)}
							</article>
						);
					})}
				</div>
			</section>

			<div className="services-back-link">
				<Link href="/">← Back to Filspresso</Link>
			</div>
		</main>
	);
}
