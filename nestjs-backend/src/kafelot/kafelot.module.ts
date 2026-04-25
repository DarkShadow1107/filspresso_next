import { Module } from "@nestjs/common";
import { KafelotController } from "./kafelot.controller";
import { KafelotService } from "./kafelot.service";
import { DatabaseModule } from "../database/database.module";

@Module({
  imports: [DatabaseModule],
  controllers: [KafelotController],
  providers: [KafelotService],
})
export class KafelotModule {}
