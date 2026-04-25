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
exports.RepairsController = void 0;
const common_1 = require("@nestjs/common");
const repairs_service_1 = require("./repairs.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
let RepairsController = class RepairsController {
    repairsService;
    constructor(repairsService) {
        this.repairsService = repairsService;
    }
    getRepairs(req) {
        return this.repairsService.getRepairs(Number(req.user?.["id"]));
    }
    submitRepair(req) {
        return this.repairsService.submitRepair(Number(req.user?.["id"]), req.body);
    }
};
exports.RepairsController = RepairsController;
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RepairsController.prototype, "getRepairs", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RepairsController.prototype, "submitRepair", null);
exports.RepairsController = RepairsController = __decorate([
    (0, common_1.Controller)("api/repairs"),
    __metadata("design:paramtypes", [repairs_service_1.RepairsService])
], RepairsController);
