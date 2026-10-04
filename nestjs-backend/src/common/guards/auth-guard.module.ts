import { Global, Module } from "@nestjs/common";
import { ActiveSessionService } from "./active-session.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { OptionalJwtAuthGuard } from "./optional-jwt-auth.guard";
import { SessionStoreService } from "./session-store.service";

// Registered globally so every controller that references the guards by class
// resolves the DI-aware instance rather than a bare `new`.
@Global()
@Module({
	providers: [
		SessionStoreService,
		ActiveSessionService,
		JwtAuthGuard,
		OptionalJwtAuthGuard,
	],
	exports: [
		SessionStoreService,
		ActiveSessionService,
		JwtAuthGuard,
		OptionalJwtAuthGuard,
	],
})
export class AuthGuardModule {}
