import { Module } from "@nestjs/common";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { FxRatesService } from "./fx-rates.service";
import { DatabaseModule } from "../database/database.module";

@Module({
	imports: [DatabaseModule],
	controllers: [OrdersController],
	providers: [OrdersService, FxRatesService],
})
export class OrdersModule {}
