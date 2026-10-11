import { forwardRef, Module } from "@nestjs/common";
import { KafelotController } from "./kafelot.controller";
import { KafelotService } from "./kafelot.service";
import { ModelUsageService } from "./model-usage.service";
import { DatabaseModule } from "../database/database.module";
import { BillingModule } from "../billing/billing.controller";

@Module({
  // BillingModule resolves a tier through KafelotService, so importing it back is a
  // cycle. forwardRef on both sides is what lets the container build the graph;
  // without it the process crash-loops at boot rather than failing at compile time.
  imports: [DatabaseModule, forwardRef(() => BillingModule)],
  controllers: [KafelotController],
  providers: [KafelotService, ModelUsageService],
  // BillingModule resolves a subscription tier through this service to decide which
  // price list a caller sees. Importing the module is not enough on its own -- Nest
  // needs the provider exported, or the container fails to resolve it and the process
  // crash-loops at boot.
  exports: [KafelotService],
})
export class KafelotModule {}
