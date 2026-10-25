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
exports.PlaygroundContextController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const playground_context_service_1 = require("./playground-context.service");
const throttler_1 = require("@nestjs/throttler");
let PlaygroundContextController = class PlaygroundContextController {
    context;
    constructor(context) {
        this.context = context;
    }
    async file(req, res, file) {
        if (!file?.buffer?.length)
            throw new common_1.BadRequestException("Choose a non-empty file.");
        return this.withCancellation(res, (signal) => this.context.prepareFile(Number(req.user?.id), file.originalname, file.buffer, signal));
    }
    async github(req, res, body) {
        if (typeof body?.url !== "string" || body.url.length > 300)
            throw new common_1.BadRequestException("Enter a GitHub repository URL.");
        return this.withCancellation(res, (signal) => this.context.prepareGithub(Number(req.user?.id), body.url, signal));
    }
    async withCancellation(res, work) {
        const controller = new AbortController();
        const close = () => controller.abort();
        res.once("close", close);
        try {
            return await work(controller.signal);
        }
        finally {
            res.off("close", close);
        }
    }
};
exports.PlaygroundContextController = PlaygroundContextController;
__decorate([
    (0, common_1.Post)("file"),
    (0, throttler_1.Throttle)({ default: { limit: 30, ttl: 60_000 } }),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 } })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], PlaygroundContextController.prototype, "file", null);
__decorate([
    (0, common_1.Post)("github"),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], PlaygroundContextController.prototype, "github", null);
exports.PlaygroundContextController = PlaygroundContextController = __decorate([
    (0, common_1.Controller)("api/playground/context"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [playground_context_service_1.PlaygroundContextService])
], PlaygroundContextController);
