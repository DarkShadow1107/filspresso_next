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
exports.OperationsController = void 0;
const common_1 = require("@nestjs/common");
const operations_service_1 = require("./operations.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const crypto_controller_1 = require("../crypto/crypto.controller");
let OperationsController = class OperationsController {
    operationsService;
    constructor(operationsService) {
        this.operationsService = operationsService;
    }
    async healthCheck() {
        return this.operationsService.healthCheck();
    }
    async ingestEvent(req, res) {
        const operationId = req.operationId;
        const body = req.body;
        const result = await this.operationsService.ingestEvent(Number(req.user?.id), operationId, body);
        res.status(common_1.HttpStatus.ACCEPTED).json(result);
    }
};
exports.OperationsController = OperationsController;
__decorate([
    (0, common_1.Get)("health"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], OperationsController.prototype, "healthCheck", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("events"),
    (0, crypto_controller_1.UseReplayGuard)("ops-events", 900),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OperationsController.prototype, "ingestEvent", null);
exports.OperationsController = OperationsController = __decorate([
    (0, common_1.Controller)("api/operations"),
    __metadata("design:paramtypes", [operations_service_1.OperationsService])
], OperationsController);
