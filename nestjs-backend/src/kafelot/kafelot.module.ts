import { Module } from "@nestjs/common";
import { KafelotController } from "./kafelot.controller";
import { KafelotService } from "./kafelot.service";
import { ModelUsageService } from "./model-usage.service";
import { DatabaseModule } from "../database/database.module";

@Module({
  imports: [DatabaseModule],
  controllers: [KafelotController],
  providers: [KafelotService, ModelUsageService],
  // BillingModule resolves a subscription tier through this service to decide which
  // price list a caller sees. Importing the module is not enough on its own -- Nest
  // needs the provider exported, or the container fails to resolve it and the process
  // crash-loops at boot.
  exports: [KafelotService],
})
export class KafelotModule {}
