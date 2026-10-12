import { forwardRef, Module } from "@nestjs/common";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { SubscriptionRenewalScheduler } from "./subscriptions-renewal.scheduler";
import { DatabaseModule } from "../database/database.module";
import { BillingModule } from "../billing/billing.controller";

@Module({
	imports: [DatabaseModule, forwardRef(() => BillingModule)],
	controllers: [SubscriptionsController],
	providers: [
		SubscriptionsService,
		// Renewals run from this module's own lifecycle rather than being polled by the
		// billing module, so the timer starts and stops with the thing that owns the schedule.
		SubscriptionRenewalScheduler,
	],
	// Exported so the admin panel can run a pass on demand. The timer still runs from this
	// module's own lifecycle -- exporting the class does not start a second timer, because
	// the scheduler is a singleton per module container.
	exports: [SubscriptionsService, SubscriptionRenewalScheduler],
})
export class SubscriptionsModule {}