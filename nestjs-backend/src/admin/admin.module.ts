import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { DatabaseModule } from "../database/database.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";

@Module({
	imports: [DatabaseModule, SubscriptionsModule],
	controllers: [AdminController],
	providers: [AdminService],
})
export class AdminModule {}
