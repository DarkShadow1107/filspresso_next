import { Controller, Get, Req } from "@nestjs/common";
import type { RequestWithId } from "../common/middleware/request-id.middleware";
import { HealthService } from "./health.service";

@Controller()
export class HealthController {
	constructor(private readonly healthService: HealthService) {}

	@Get("health")
	getHealth(@Req() req: RequestWithId) {
		return this.healthService.getLiveness(req.requestId);
	}

	@Get("health/services")
	async getServicesHealth(@Req() req: RequestWithId) {
		return this.healthService.getServicesHealth(req.requestId);
	}
}
