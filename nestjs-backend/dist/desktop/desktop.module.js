"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopModule = void 0;
const common_1 = require("@nestjs/common");
const desktop_controller_1 = require("./desktop.controller");
const desktop_web_controller_1 = require("./desktop-web.controller");
const desktop_web_service_1 = require("./desktop-web.service");
const desktop_gateway_service_1 = require("./desktop-gateway.service");
const desktop_installer_service_1 = require("./desktop-installer.service");
const billing_controller_1 = require("../billing/billing.controller");
const playground_context_controller_1 = require("./playground-context.controller");
const playground_context_service_1 = require("./playground-context.service");
const playground_controller_1 = require("./playground.controller");
const playground_sandbox_controller_1 = require("./playground-sandbox.controller");
const playground_sandbox_service_1 = require("./playground-sandbox.service");
const playground_run_events_service_1 = require("./playground-run-events.service");
const playground_sessions_controller_1 = require("./playground-sessions.controller");
const playground_sessions_service_1 = require("./playground-sessions.service");
const playground_agent_controller_1 = require("./playground-agent.controller");
const playground_agent_tickets_service_1 = require("./playground-agent-tickets.service");
const playground_agent_actions_service_1 = require("./playground-agent-actions.service");
const playground_agent_actions_controller_1 = require("./playground-agent-actions.controller");
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
let DesktopModule = class DesktopModule {
};
exports.DesktopModule = DesktopModule;
exports.DesktopModule = DesktopModule = __decorate([
    (0, common_1.Module)({
        imports: [billing_controller_1.BillingModule],
        controllers: [desktop_controller_1.DesktopController, desktop_web_controller_1.DesktopWebController, playground_context_controller_1.PlaygroundContextController, playground_controller_1.PlaygroundController, playground_sandbox_controller_1.PlaygroundSandboxController, playground_sessions_controller_1.PlaygroundSessionsController, playground_agent_controller_1.PlaygroundAgentController, playground_agent_actions_controller_1.PlaygroundAgentActionsController],
        providers: [desktop_gateway_service_1.DesktopGatewayService, desktop_web_service_1.DesktopWebService, desktop_installer_service_1.DesktopInstallerService, playground_context_service_1.PlaygroundContextService, playground_sandbox_service_1.PlaygroundSandboxService, playground_run_events_service_1.PlaygroundRunEventsService, playground_sessions_service_1.PlaygroundSessionsService, playground_agent_tickets_service_1.PlaygroundAgentTicketsService, playground_agent_actions_service_1.PlaygroundAgentActionsService],
    })
], DesktopModule);
