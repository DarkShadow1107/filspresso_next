"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KafelotModule = void 0;
const common_1 = require("@nestjs/common");
const kafelot_controller_1 = require("./kafelot.controller");
const kafelot_service_1 = require("./kafelot.service");
const model_usage_service_1 = require("./model-usage.service");
const database_module_1 = require("../database/database.module");
const billing_controller_1 = require("../billing/billing.controller");
let KafelotModule = class KafelotModule {
};
exports.KafelotModule = KafelotModule;
exports.KafelotModule = KafelotModule = __decorate([
    (0, common_1.Module)({
        // BillingModule resolves a tier through KafelotService, so importing it back is a
        // cycle. forwardRef on both sides is what lets the container build the graph;
        // without it the process crash-loops at boot rather than failing at compile time.
        imports: [database_module_1.DatabaseModule, (0, common_1.forwardRef)(() => billing_controller_1.BillingModule)],
        controllers: [kafelot_controller_1.KafelotController],
        providers: [kafelot_service_1.KafelotService, model_usage_service_1.ModelUsageService],
        // BillingModule resolves a subscription tier through this service to decide which
        // price list a caller sees. Importing the module is not enough on its own -- Nest
        // needs the provider exported, or the container fails to resolve it and the process
        // crash-loops at boot.
        exports: [kafelot_service_1.KafelotService],
    })
], KafelotModule);
