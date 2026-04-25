import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { Policy } from "../common/decorators/policy.decorator";
import { PolicyGuard } from "../common/guards/policy.guard";
import type { RequestWithId } from "../common/middleware/request-id.middleware";
import { SecurityObservabilityService } from "./security-observability.service";
import { ServiceEventsAuthGuard } from "./service-events-auth.guard";

function parseBoundedInt(raw: unknown, fallback: number, min: number, max: number): number {
	const parsed = Number.parseInt(String(raw ?? ""), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(parsed, min), max);
}

@Controller("health")
export class SecurityObservabilityController {
	constructor(private readonly securityObservabilityService: SecurityObservabilityService) {}

	@Get("services/events")
	async getServiceEvents(
		@Req() req: RequestWithId,
		@Query("limit") limitQuery?: string,
		@Query("windowHours") windowHoursQuery?: string,
	) {
		const limit = parseBoundedInt(limitQuery, 120, 1, 1000);
		const windowHours = parseBoundedInt(windowHoursQuery, 24, 1, 24 * 365);

		return this.securityObservabilityService.getServiceIncidentHistory(limit, windowHours, req.requestId);
	}

	@Get("security/observability")
	@UseGuards(ServiceEventsAuthGuard, PolicyGuard)
	@Policy({ resource: "service-events", action: "observe" })
	async getSecurityObservability(
		@Req() req: RequestWithId,
		@Query("windowMinutes") windowMinutesQuery?: string,
		@Query("mpcStaleMinutes") mpcStaleMinutesQuery?: string,
	) {
		const windowMinutes = parseBoundedInt(windowMinutesQuery, 60, 5, 24 * 60);
		const mpcStaleMinutes = parseBoundedInt(mpcStaleMinutesQuery, 30, 5, 24 * 60);

		const snapshot = await this.securityObservabilityService.collectSecurityObservabilitySnapshot({
			windowMinutes,
			mpcStaleMinutes,
		});

		return {
			...snapshot,
			requestId: req.requestId,
		};
	}

	@Get("security/alerts")
	@UseGuards(ServiceEventsAuthGuard, PolicyGuard)
	@Policy({ resource: "service-events", action: "alerts" })
	async getSecurityAlerts(@Req() req: RequestWithId) {
		return this.securityObservabilityService.getSecurityAlerts(req.requestId);
	}

	@Post("security/alerts/dispatch")
	@UseGuards(ServiceEventsAuthGuard, PolicyGuard)
	@Policy({ resource: "service-events", action: "alerts" })
	async dispatchSecurityAlerts(@Req() req: RequestWithId, @Body() body: Record<string, unknown>) {
		return this.securityObservabilityService.dispatchSecurityAlert(body, req.requestId);
	}

	@Get("services/ledger/verify")
	@UseGuards(ServiceEventsAuthGuard)
	async verifyServiceLedger(
		@Req() req: RequestWithId,
		@Query("chainScope") chainScopeQuery: string | undefined,
		@Query("maxRows") maxRowsQuery: string | undefined,
		@Res() res: Response,
	): Promise<void> {
		const chainScope = String(chainScopeQuery || "service-health").trim() || "service-health";
		const maxRows = parseBoundedInt(maxRowsQuery, 10000, 1, 100000);

		const result = await this.securityObservabilityService.verifySecurityLedger(chainScope, maxRows, req.requestId);

		res.status(result.statusCode).json(result.payload);
	}

	@Post("services/events/bulk")
	@UseGuards(ServiceEventsAuthGuard, PolicyGuard)
	@Policy({ resource: "service-events", action: "ingest" })
	async ingestServiceEventsBulk(@Req() req: RequestWithId, @Body() body: Record<string, unknown>) {
		const events = Array.isArray(body.events)
			? (body.events.filter(
					(entry): entry is Record<string, unknown> =>
						entry !== null && typeof entry === "object" && !Array.isArray(entry),
				) as Array<Record<string, unknown>>)
			: [];

		return this.securityObservabilityService.ingestServiceEventsBulk(events, req.requestId);
	}
}
