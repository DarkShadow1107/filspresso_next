import { Module } from "@nestjs/common";
import { SecurityObservabilityController } from "./security-observability.controller";
import { SecurityObservabilityScheduler } from "./security-observability.scheduler";
import { SecurityObservabilityService } from "./security-observability.service";
import { ServiceEventsAuthGuard } from "./service-events-auth.guard";
import { DatabaseModule } from "../database/database.module";

@Module({
	// Phase 7.5: the scheduler now owns the replay-guard expiry sweep and needs the pool.
	imports: [DatabaseModule],
	controllers: [SecurityObservabilityController],
	providers: [SecurityObservabilityService, ServiceEventsAuthGuard, SecurityObservabilityScheduler],
	exports: [SecurityObservabilityService, ServiceEventsAuthGuard],
})
export class SecurityObservabilityModule {}
