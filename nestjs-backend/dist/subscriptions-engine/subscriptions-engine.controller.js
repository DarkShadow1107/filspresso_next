"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionsEngineController = void 0;
const common_1 = require("@nestjs/common");
const subscriptions_engine_service_1 = require("./subscriptions-engine.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
let SubscriptionsEngineController = class SubscriptionsEngineController {
    engineService;
    constructor(engineService) {
        this.engineService = engineService;
    }
    getHealth() { return this.engineService.getHealth(); }
    getQuote(req) {
        return this.engineService.getQuote(req.user ?? {}, req.body);
    }
};
exports.SubscriptionsEngineController = SubscriptionsEngineController;
__decorate([
    (0, common_1.Get)("health"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SubscriptionsEngineController.prototype, "getHealth", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("quote"),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SubscriptionsEngineController.prototype, "getQuote", null);
exports.SubscriptionsEngineController = SubscriptionsEngineController = __decorate([
    (0, common_1.Controller)("api/subscriptions-engine"),
    __metadata("design:paramtypes", [subscriptions_engine_service_1.SubscriptionsEngineService])
], SubscriptionsEngineController);
