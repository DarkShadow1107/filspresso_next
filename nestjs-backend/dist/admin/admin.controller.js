"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const admin_service_1 = require("./admin.service");
const path = __importStar(require("path"));
const { diskStorage } = require("multer");
let AdminController = class AdminController {
    adminService;
    constructor(adminService) {
        this.adminService = adminService;
    }
    async login(req, res) {
        const result = await this.adminService.login(req, res);
        if (!res.headersSent) {
            if (result.status === "mfa_required" || result.status === "mfa_enrollment_required") {
                return res.status(common_1.HttpStatus.ACCEPTED).json(result);
            }
            return res.status(common_1.HttpStatus.OK).json(result);
        }
    }
    async mfaVerify(req, res) {
        const result = await this.adminService.mfaVerify(req, res);
        if (!res.headersSent) {
            return res.status(common_1.HttpStatus.OK).json(result);
        }
    }
    async logout(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.logout(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async session(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.session(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async sensitiveUnlock(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.sensitiveUnlock(req, res);
        if (!res.headersSent) {
            return res.status(common_1.HttpStatus.OK).json(result);
        }
    }
    async sensitiveLock(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.sensitiveLock(req, res);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async getTables(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.getTables(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async getTableInfo(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.getTableInfo(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async getTableData(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.getTableData(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async insertRow(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.insertRow(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async updateRow(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.updateRow(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async deleteRow(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.deleteRow(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async executeQuery(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.executeQuery(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async getTelemetry(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.getTelemetry(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async getSecurityEvents(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.getSecurityEvents(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async clearLockout(req, res) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        const result = await this.adminService.clearLockout(req);
        return res.status(common_1.HttpStatus.OK).json(result);
    }
    async uploadImage(req, res, file) {
        await this.adminService.authenticateAdmin(req, res);
        if (res.headersSent)
            return;
        if (!file) {
            return res.status(400).json({ error: "No image file provided" });
        }
        const productType = (req.body?.product_type || "").toString().trim();
        const category = (req.body?.category || "").toString().trim();
        if (!productType || !category) {
            if (file.path)
                require("fs").unlink(file.path, () => { });
            return res.status(400).json({ error: "product_type and category are required before uploading an image" });
        }
        const target = req.uploadTarget;
        const extension = path.extname(file.filename || "").toLowerCase().replace(".", "");
        const relativePath = path.join(target.relativeDir, file.filename).replace(/\\/g, "/");
        return res.status(common_1.HttpStatus.OK).json({ status: "success", filename: file.filename, extension, relativePath });
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Post)("login"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "login", null);
__decorate([
    (0, common_1.Post)("mfa/verify"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "mfaVerify", null);
__decorate([
    (0, common_1.Post)("logout"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)("session"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "session", null);
__decorate([
    (0, common_1.Post)("sensitive/unlock"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "sensitiveUnlock", null);
__decorate([
    (0, common_1.Post)("sensitive/lock"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "sensitiveLock", null);
__decorate([
    (0, common_1.Get)("tables"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getTables", null);
__decorate([
    (0, common_1.Get)("table-info/:table"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getTableInfo", null);
__decorate([
    (0, common_1.Get)("tables/:table"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getTableData", null);
__decorate([
    (0, common_1.Post)("tables/:table"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "insertRow", null);
__decorate([
    (0, common_1.Put)("tables/:table/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateRow", null);
__decorate([
    (0, common_1.Delete)("tables/:table/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "deleteRow", null);
__decorate([
    (0, common_1.Post)("query"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "executeQuery", null);
__decorate([
    (0, common_1.Get)("security/telemetry"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getTelemetry", null);
__decorate([
    (0, common_1.Get)("security/events"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getSecurityEvents", null);
__decorate([
    (0, common_1.Delete)("security/lockouts/:loginKey"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "clearLockout", null);
__decorate([
    (0, common_1.Post)("upload/coffee-image"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("image", {
        storage: diskStorage({
            destination: (req, file, cb) => {
                try {
                    const { product_type: productType = "", category = "" } = req.body || {};
                    const adminService = req.__adminService; // Hack to access service method
                    const target = adminService.resolveImageTarget(productType, category);
                    req.uploadTarget = target;
                    require("fs").mkdirSync(target.absoluteDir, { recursive: true });
                    cb(null, target.absoluteDir);
                }
                catch (err) {
                    cb(err, "");
                }
            },
            filename: (req, file, cb) => {
                const adminService = req.__adminService;
                if (!adminService.isAllowedImage(file)) {
                    return cb(new Error("Invalid image type"), "");
                }
                const safeName = require("path").basename(file.originalname);
                cb(null, safeName);
            }
        }),
        fileFilter: (req, file, cb) => {
            const adminService = req.__adminService;
            if (!adminService.isAllowedImage(file)) {
                return cb(new Error("Only png, avif, webp, jpg, or jpeg are allowed"), false);
            }
            cb(null, true);
        },
        limits: { fileSize: 15 * 1024 * 1024 }
    })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "uploadImage", null);
exports.AdminController = AdminController = __decorate([
    (0, common_1.Controller)("api/admin"),
    __metadata("design:paramtypes", [admin_service_1.AdminService])
], AdminController);
