import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminUploadAuthGuard } from "./admin-upload-auth.guard";
import { DatabaseModule } from "../database/database.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";

@Module({
	imports: [DatabaseModule, SubscriptionsModule],
	controllers: [AdminController],
	providers: [AdminService, AdminUploadAuthGuard],
})
export class AdminModule {}
