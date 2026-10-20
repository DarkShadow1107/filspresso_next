import { Module } from "@nestjs/common";
import { DesktopController } from "./desktop.controller";
import { DesktopWebController } from "./desktop-web.controller";
import { DesktopWebService } from "./desktop-web.service";
import { DesktopGatewayService } from "./desktop-gateway.service";
import { BillingModule } from "../billing/billing.controller";

/**
 * The desktop client's backend surface.
 *
 * One module for the whole client rather than scattering `desktop` routes across billing
 * and auth. The reason those two could not host it is worth recording: the entitlement
 * endpoint needs BillingService and AddonsService together, and the streaming gateway needs
 * both *plus* the AI host. Putting a route in `auth` would drag billing into auth, and
 * putting it in `billing` would make the client-specific surface look like part of the
 * product's billing API.
 *
 * It imports BillingModule for its services, not its controllers, so nothing here can
 * re-export or shadow a billing route.
 */
@Module({
	imports: [BillingModule],
	controllers: [DesktopController, DesktopWebController],
	providers: [DesktopGatewayService, DesktopWebService],
})
export class DesktopModule {}
