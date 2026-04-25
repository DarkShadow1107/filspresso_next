import { Module } from "@nestjs/common";
import { RepairsController } from "./repairs.controller";
import { RepairsService } from "./repairs.service";
import { DatabaseModule } from "../database/database.module";

@Module({
  imports: [DatabaseModule],
  controllers: [RepairsController],
  providers: [RepairsService],
})
export class RepairsModule {}
