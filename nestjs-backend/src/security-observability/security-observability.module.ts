import { Module } from "@nestjs/common";
import { SecurityObservabilityController } from "./security-observability.controller";
import { SecurityObservabilityScheduler } from "./security-observability.scheduler";
import { SecurityObservabilityService } from "./security-observability.service";
import { ServiceEventsAuthGuard } from "./service-events-auth.guard";

@Module({
	controllers: [SecurityObservabilityController],
	providers: [SecurityObservabilityService, ServiceEventsAuthGuard, SecurityObservabilityScheduler],
	exports: [SecurityObservabilityService, ServiceEventsAuthGuard],
})
export class SecurityObservabilityModule {}
