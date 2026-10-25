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
exports.PlaygroundSandboxController = void 0;
const common_1 = require("@nestjs/common");
const exact_playground_body_1 = require("../common/pipes/exact-playground-body");
const throttler_1 = require("@nestjs/throttler");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const playground_sandbox_service_1 = require("./playground-sandbox.service");
function identity(value) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
        throw new common_1.BadRequestException("Invalid sandbox ID");
    return value;
}
let PlaygroundSandboxController = class PlaygroundSandboxController {
    sandboxes;
    constructor(sandboxes) {
        this.sandboxes = sandboxes;
    }
    health(req) { return this.sandboxes.request(Number(req.user?.id), "GET", "/health"); }
    create(req) { return this.sandboxes.request(Number(req.user?.id), "POST", "/sandboxes"); }
    stop(req, id) { return this.sandboxes.request(Number(req.user?.id), "DELETE", `/sandboxes/${identity(id)}`); }
    files(req, id) { return this.sandboxes.request(Number(req.user?.id), "GET", `/sandboxes/${identity(id)}/files`); }
    read(req, id, path) {
        if (typeof path !== "string" || path.length > 240)
            throw new common_1.BadRequestException("Invalid workspace path");
        return this.sandboxes.request(Number(req.user?.id), "GET", `/sandboxes/${identity(id)}/file?${new URLSearchParams({ path })}`);
    }
    write(req, id, body) {
        if (typeof body?.path !== "string" || body.path.length > 240 || typeof body.text !== "string" || Buffer.byteLength(body.text) > 256 * 1024)
            throw new common_1.BadRequestException("Choose a workspace path and UTF-8 text no larger than 256 KiB");
        return this.sandboxes.request(Number(req.user?.id), "PUT", `/sandboxes/${identity(id)}/file`, { path: body.path, text: body.text });
    }
    async run(req, id, body, res) {
        if (typeof body?.command !== "string" || !body.command.trim() || body.command.length > 4000 || body.approved !== true)
            throw new common_1.BadRequestException("Review a command and explicitly approve execution");
        return this.sandboxes.run(Number(req.user?.id), identity(id), { command: body.command, approved: true, timeoutSeconds: 30 }, res);
    }
};
exports.PlaygroundSandboxController = PlaygroundSandboxController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PlaygroundSandboxController.prototype, "health", null);
__decorate([
    (0, common_1.Post)(),
    (0, throttler_1.Throttle)({ default: { limit: 6, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PlaygroundSandboxController.prototype, "create", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PlaygroundSandboxController.prototype, "stop", null);
__decorate([
    (0, common_1.Get)(":id/files"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PlaygroundSandboxController.prototype, "files", null);
__decorate([
    (0, common_1.Get)(":id/file"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Query)("path")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PlaygroundSandboxController.prototype, "read", null);
__decorate([
    (0, common_1.Put)(":id/file"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, exact_playground_body_1.ExactPlaygroundBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], PlaygroundSandboxController.prototype, "write", null);
__decorate([
    (0, common_1.Post)(":id/run"),
    (0, throttler_1.Throttle)({ default: { limit: 12, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, exact_playground_body_1.ExactPlaygroundBody)()),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], PlaygroundSandboxController.prototype, "run", null);
exports.PlaygroundSandboxController = PlaygroundSandboxController = __decorate([
    (0, common_1.Controller)("api/playground/sandbox"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [playground_sandbox_service_1.PlaygroundSandboxService])
], PlaygroundSandboxController);
