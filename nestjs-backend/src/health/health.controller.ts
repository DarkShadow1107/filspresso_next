import { Controller, Get, Req } from "@nestjs/common";
import type { RequestWithId } from "../common/middleware/request-id.middleware";
import { HealthService } from "./health.service";
import { Throttle } from "@nestjs/throttler";
import { ruleFor } from "../config/rate-limit.policy";

@Controller()
export class HealthController {
	constructor(private readonly healthService: HealthService) {}

	@Get("health")
	getHealth(@Req() req: RequestWithId) {
		return this.healthService.getLiveness(req.requestId);
	}

	@Throttle({ default: { limit: ruleFor("GET /health/services").limit, ttl: ruleFor("GET /health/services").ttlMs } })
	@Get("health/services")
	async getServicesHealth(@Req() req: RequestWithId) {
		return this.healthService.getServicesHealth(req.requestId);
	}
}
