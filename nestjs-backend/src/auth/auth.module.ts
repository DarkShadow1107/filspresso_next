import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthComplexController } from "./auth-complex.controller";
import { AuthComplexService } from "./auth-complex.service";
import { DatabaseModule } from "../database/database.module";

@Module({
	imports: [DatabaseModule],
	controllers: [AuthController, AuthComplexController],
	providers: [AuthService, AuthComplexService],
	exports: [AuthService, AuthComplexService],
})
export class AuthModule {}
