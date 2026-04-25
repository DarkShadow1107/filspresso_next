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
exports.KafelotController = void 0;
const common_1 = require("@nestjs/common");
const kafelot_service_1 = require("./kafelot.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const optional_jwt_auth_guard_1 = require("../common/guards/optional-jwt-auth.guard");
const net = __importStar(require("net"));
function normalizeClientIp(value) {
    if (!value)
        return null;
    let candidate = Array.isArray(value) ? String(value[0] || "") : String(value).split(",")[0].trim();
    candidate = candidate.replace(/^"|"$/g, "").trim();
    if (!candidate)
        return null;
    if (candidate.startsWith("[") && candidate.includes("]"))
        candidate = candidate.slice(1, candidate.indexOf("]")).trim();
    const mappedIpv4Match = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mappedIpv4Match && net.isIP(mappedIpv4Match[1]) === 4)
        return mappedIpv4Match[1];
    if (net.isIP(candidate))
        return candidate;
    const ipv4WithPortMatch = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPortMatch && net.isIP(ipv4WithPortMatch[1]) === 4)
        return ipv4WithPortMatch[1];
    return null;
}
function getClientIp(req) {
    return normalizeClientIp(req.headers["cf-connecting-ip"]) ||
        normalizeClientIp(req.headers["x-real-ip"]) ||
        normalizeClientIp(req.headers["x-forwarded-for"]) ||
        normalizeClientIp(req.ip) ||
        normalizeClientIp(req.socket?.remoteAddress) || null;
}
function resolveUsageScope(req) {
    const bodyScope = req.body && typeof req.body === "object" ? req.body.scope : undefined;
    const headerScope = req.headers["x-kafelot-scope"];
    const queryScope = req.query?.scope;
    return (0, kafelot_service_1.normalizeUsageScope)((bodyScope || headerScope || queryScope || kafelot_service_1.USAGE_SCOPES.GENERAL));
}
let KafelotController = class KafelotController {
    kafelotService;
    constructor(kafelotService) {
        this.kafelotService = kafelotService;
    }
    async checkAndUse(req, res) {
        const fingerprint = req.headers["x-kafelot-fingerprint"];
        const hasBearerToken = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
        const ip = getClientIp(req);
        const userAgent = req.headers["user-agent"] || "";
        const systemInfo = req.body?.system_info || {};
        const dryRun = req.body?.dry_run === true;
        const usageScope = resolveUsageScope(req);
        if (hasBearerToken && !req.user) {
            return res.status(common_1.HttpStatus.UNAUTHORIZED).json({ error: "AUTH_SESSION_INVALID", message: "Authentication session expired or invalid" });
        }
        const result = await this.kafelotService.checkAndUse({
            accountId: req.user?.id, fingerprint, ip, userAgent, systemInfo, dryRun, usageScope, hasBearerToken
        });
        return res.status(result.status).json(result.data);
    }
    async getStatus(req, res) {
        const fingerprint = req.headers["x-kafelot-fingerprint"];
        const hasBearerToken = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
        const ip = getClientIp(req);
        const userAgent = req.headers["user-agent"] || "";
        const usageScope = resolveUsageScope(req);
        if (hasBearerToken && !req.user) {
            return res.status(common_1.HttpStatus.UNAUTHORIZED).json({ error: "AUTH_SESSION_INVALID", message: "Authentication session expired or invalid" });
        }
        const result = await this.kafelotService.getStatus({
            accountId: req.user?.id, fingerprint, ip, userAgent, usageScope, hasBearerToken
        });
        return res.status(result.status).json(result.data);
    }
    getAnonymousUsers(req, limit, offset, search, res) {
        if (req.user?.role !== "admin")
            return res.status(common_1.HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
        return this.kafelotService.getAnonymousUsers(Number.parseInt(limit || "50", 10), Number.parseInt(offset || "0", 10), search || "").then(r => res.json(r));
    }
    updateAnonymousUser(req, id, res) {
        if (req.user?.role !== "admin")
            return res.status(common_1.HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
        return this.kafelotService.updateAnonymousUser(id, req.body.prompts_limit, req.body.prompts_used).then(r => res.json(r)).catch(e => {
            if (e.status === 404)
                return res.status(404).json({ error: "Not found" });
            return res.status(500).json({ error: "Internal server error" });
        });
    }
    getUsersUsage(req, limit, offset, monthYear, scope, res) {
        if (req.user?.role !== "admin")
            return res.status(common_1.HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
        return this.kafelotService.getUsersUsage(Number.parseInt(limit || "50", 10), Number.parseInt(offset || "0", 10), monthYear, scope).then(r => res.json(r));
    }
    updateUserUsage(req, id, res) {
        if (req.user?.role !== "admin")
            return res.status(common_1.HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
        return this.kafelotService.updateUserUsage(id, req.body.prompts_limit, req.body.prompts_used).then(r => res.json(r)).catch(e => {
            if (e.status === 404)
                return res.status(404).json({ error: "Not found" });
            return res.status(500).json({ error: "Internal server error" });
        });
    }
};
exports.KafelotController = KafelotController;
__decorate([
    (0, common_1.UseGuards)(optional_jwt_auth_guard_1.OptionalJwtAuthGuard),
    (0, common_1.Post)("check-and-use"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], KafelotController.prototype, "checkAndUse", null);
__decorate([
    (0, common_1.UseGuards)(optional_jwt_auth_guard_1.OptionalJwtAuthGuard),
    (0, common_1.Get)("status"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], KafelotController.prototype, "getStatus", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("anonymous"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("limit")),
    __param(2, (0, common_1.Query)("offset")),
    __param(3, (0, common_1.Query)("search")),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], KafelotController.prototype, "getAnonymousUsers", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Put)("anonymous/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", void 0)
], KafelotController.prototype, "updateAnonymousUser", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("users"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("limit")),
    __param(2, (0, common_1.Query)("offset")),
    __param(3, (0, common_1.Query)("month_year")),
    __param(4, (0, common_1.Query)("scope")),
    __param(5, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], KafelotController.prototype, "getUsersUsage", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Put)("users/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", void 0)
], KafelotController.prototype, "updateUserUsage", null);
exports.KafelotController = KafelotController = __decorate([
    (0, common_1.Controller)("api/kafelot"),
    __metadata("design:paramtypes", [kafelot_service_1.KafelotService])
], KafelotController);
