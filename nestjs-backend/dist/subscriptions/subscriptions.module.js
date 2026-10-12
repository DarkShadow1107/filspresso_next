"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionsModule = void 0;
const common_1 = require("@nestjs/common");
const subscriptions_controller_1 = require("./subscriptions.controller");
const subscriptions_service_1 = require("./subscriptions.service");
const subscriptions_renewal_scheduler_1 = require("./subscriptions-renewal.scheduler");
const database_module_1 = require("../database/database.module");
const billing_controller_1 = require("../billing/billing.controller");
let SubscriptionsModule = class SubscriptionsModule {
};
exports.SubscriptionsModule = SubscriptionsModule;
exports.SubscriptionsModule = SubscriptionsModule = __decorate([
    (0, common_1.Module)({
        imports: [database_module_1.DatabaseModule, (0, common_1.forwardRef)(() => billing_controller_1.BillingModule)],
        controllers: [subscriptions_controller_1.SubscriptionsController],
        providers: [
            subscriptions_service_1.SubscriptionsService,
            // Renewals run from this module's own lifecycle rather than being polled by the
            // billing module, so the timer starts and stops with the thing that owns the schedule.
            subscriptions_renewal_scheduler_1.SubscriptionRenewalScheduler,
        ],
        // Exported so the admin panel can run a pass on demand. The timer still runs from this
        // module's own lifecycle -- exporting the class does not start a second timer, because
        // the scheduler is a singleton per module container.
        exports: [subscriptions_service_1.SubscriptionsService, subscriptions_renewal_scheduler_1.SubscriptionRenewalScheduler],
    })
], SubscriptionsModule);
