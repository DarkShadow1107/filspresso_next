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
exports.AuthComplexController = void 0;
const common_1 = require("@nestjs/common");
const auth_complex_service_1 = require("./auth-complex.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
let AuthComplexController = class AuthComplexController {
    authComplexService;
    constructor(authComplexService) {
        this.authComplexService = authComplexService;
    }
    async register(req, res) {
        const result = await this.authComplexService.register(req);
        return res.status(common_1.HttpStatus.CREATED).json(result);
    }
    async login(req, res) {
        const result = await this.authComplexService.login(req, res);
        if (!res.headersSent) {
            if (result.status === "mfa_required") {
                return res.status(common_1.HttpStatus.ACCEPTED).json(result);
            }
            return res.status(common_1.HttpStatus.OK).json(result);
        }
    }
    async loginMfaVerify(req, res) {
        const result = await this.authComplexService.loginMfaVerify(req, res);
        if (!res.headersSent) {
            return res.status(common_1.HttpStatus.OK).json(result);
        }
    }
    async refresh(req, res) {
        const result = await this.authComplexService.refresh(req, res);
        if (!res.headersSent) {
            return res.status(common_1.HttpStatus.OK).json(result);
        }
    }
    async verifyEmail(req, res) {
        await this.authComplexService.verifyEmail(req, res);
    }
    async resendVerification(req, res) {
        const result = await this.authComplexService.resendVerification(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async oauthStart(req, res) {
        await this.authComplexService.oauthStart(req, res);
    }
    async oauthCallback(req, res) {
        await this.authComplexService.oauthCallback(req, res);
    }
    async mfaSetup(req, res) {
        const result = await this.authComplexService.mfaSetup(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async mfaEnable(req, res) {
        const result = await this.authComplexService.mfaEnable(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
};
exports.AuthComplexController = AuthComplexController;
__decorate([
    (0, common_1.Post)("register"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthComplexController.prototype, "register", null);
__decorate([
    (0, common_1.Post)("login"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthComplexController.prototype, "login", null);
__decorate([
    (0, common_1.Post)("login/mfa-verify"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthComplexController.prototype, "loginMfaVerify", null);
__decorate([
    (0, common_1.Post)("refresh"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthComplexController.prototype, "refresh", null);
__decorate([
    (0, common_1.Get)("verify-email"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthComplexController.prototype, "verifyEmail", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("verify-email/resend"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthComplexController.prototype, "resendVerification", null);
__decorate([
    (0, common_1.Get)("oauth/:provider/start"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthComplexController.prototype, "oauthStart", null);
__decorate([
    (0, common_1.Get)("oauth/:provider/callback"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthComplexController.prototype, "oauthCallback", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("mfa/setup"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthComplexController.prototype, "mfaSetup", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("mfa/enable"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthComplexController.prototype, "mfaEnable", null);
exports.AuthComplexController = AuthComplexController = __decorate([
    (0, common_1.Controller)("api/auth"),
    __metadata("design:paramtypes", [auth_complex_service_1.AuthComplexService])
], AuthComplexController);
