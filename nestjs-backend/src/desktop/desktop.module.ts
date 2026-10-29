import { Module } from "@nestjs/common";
import { DesktopController } from "./desktop.controller";
import { DesktopWebController } from "./desktop-web.controller";
import { DesktopWebService } from "./desktop-web.service";
import { DesktopGatewayService } from "./desktop-gateway.service";
import { DesktopInstallerService } from "./desktop-installer.service";
import { DesktopInstallerRegistryService } from "./desktop-installer-registry.service";
import { BillingModule } from "../billing/billing.controller";
import { PlaygroundContextController } from "./playground-context.controller";
import { PlaygroundContextService } from "./playground-context.service";
import { PlaygroundController } from "./playground.controller";
import { PlaygroundSandboxController } from "./playground-sandbox.controller";
import { PlaygroundSandboxService } from "./playground-sandbox.service";
import { PlaygroundRunEventsService } from "./playground-run-events.service";
import { PlaygroundSessionsController } from "./playground-sessions.controller";
import { PlaygroundSessionsService } from "./playground-sessions.service";
import { PlaygroundAgentController } from "./playground-agent.controller";
import { PlaygroundAgentTicketsService } from "./playground-agent-tickets.service";
import { PlaygroundAgentActionsService } from "./playground-agent-actions.service";
import { PlaygroundAgentActionsController } from "./playground-agent-actions.controller";
import { PlaygroundDocumentsController } from "./playground-documents.controller";
import { PlaygroundDocumentsService } from "./playground-documents.service";

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
	controllers: [DesktopController, DesktopWebController, PlaygroundContextController, PlaygroundController, PlaygroundSandboxController, PlaygroundSessionsController, PlaygroundAgentController, PlaygroundAgentActionsController, PlaygroundDocumentsController],
	providers: [DesktopGatewayService, DesktopWebService, DesktopInstallerService, DesktopInstallerRegistryService, PlaygroundContextService, PlaygroundSandboxService, PlaygroundRunEventsService, PlaygroundSessionsService, PlaygroundAgentTicketsService, PlaygroundAgentActionsService, PlaygroundDocumentsService],
  })
  export class DesktopModule {}
