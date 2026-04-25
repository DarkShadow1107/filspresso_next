"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionsEngineModule = void 0;
const common_1 = require("@nestjs/common");
const subscriptions_engine_controller_1 = require("./subscriptions-engine.controller");
const subscriptions_engine_service_1 = require("./subscriptions-engine.service");
let SubscriptionsEngineModule = class SubscriptionsEngineModule {
};
exports.SubscriptionsEngineModule = SubscriptionsEngineModule;
exports.SubscriptionsEngineModule = SubscriptionsEngineModule = __decorate([
    (0, common_1.Module)({
        controllers: [subscriptions_engine_controller_1.SubscriptionsEngineController],
        providers: [subscriptions_engine_service_1.SubscriptionsEngineService],
        exports: [subscriptions_engine_service_1.SubscriptionsEngineService],
    })
], SubscriptionsEngineModule);
