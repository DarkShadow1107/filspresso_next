import { Module } from "@nestjs/common";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { DatabaseModule } from "../database/database.module";

@Module({
	imports: [DatabaseModule],
	controllers: [AccountsController],
	providers: [AccountsService],
})
export class AccountsModule {}
