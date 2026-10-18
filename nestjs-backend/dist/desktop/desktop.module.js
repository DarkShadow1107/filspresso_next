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
const desktop_gateway_service_1 = require("./desktop-gateway.service");
const billing_controller_1 = require("../billing/billing.controller");
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
        controllers: [desktop_controller_1.DesktopController],
        providers: [desktop_gateway_service_1.DesktopGatewayService],
    })
], DesktopModule);
