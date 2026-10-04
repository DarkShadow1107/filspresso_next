import { Module } from "@nestjs/common";
import { KafelotController } from "./kafelot.controller";
import { KafelotService } from "./kafelot.service";
import { ModelUsageService } from "./model-usage.service";
import { DatabaseModule } from "../database/database.module";

@Module({
  imports: [DatabaseModule],
  controllers: [KafelotController],
  providers: [KafelotService, ModelUsageService],
})
export class KafelotModule {}
