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
exports.CryptoController = exports.ReplayGuardInterceptor = void 0;
exports.UseReplayGuard = UseReplayGuard;
const common_1 = require("@nestjs/common");
const crypto_service_1 = require("./crypto.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const crypto = __importStar(require("crypto"));
const replayGuard = __importStar(require("../common/utils/replayGuard"));
const database_service_1 = require("../database/database.service");
const common_2 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const REPLAY_GUARD_STRICT_REQUIRED = String(process.env.OPERATION_REPLAY_REQUIRE_ID || "false").trim().toLowerCase() === "true";
let ReplayGuardInterceptor = class ReplayGuardInterceptor {
    db;
    reflector;
    constructor(db, reflector) {
        this.db = db;
        this.reflector = reflector;
    }
    async intercept(context, next) {
        const ctx = context.switchToHttp();
        const req = ctx.getRequest();
        const res = ctx.getResponse();
        const options = this.reflector.get("replayGuard", context.getHandler());
        if (!options)
            return next.handle();
        const providedOperationId = replayGuard.extractOperationId(req);
        const normalizedProvided = replayGuard.normalizeOperationId(providedOperationId);
        if (providedOperationId && !normalizedProvided)
            throw new common_1.BadRequestException({ error: "Invalid operation id", reason: "operation_id_format_invalid" });
        let operationId = normalizedProvided;
        if (!operationId) {
            if (REPLAY_GUARD_STRICT_REQUIRED)
                throw new common_1.BadRequestException({ error: "Operation id is required", reason: "operation_id_missing" });
            operationId = `op_${crypto.randomUUID().replace(/-/g, "")}`;
        }
        let actorId = "anonymous";
        if (req.user?.id)
            actorId = `user:${req.user.id}`;
        else if (req.ip)
            actorId = `ip:${String(req.ip).slice(0, 64)}`;
        const pool = this.db.getPool();
        const reservation = await replayGuard.reserveReplayOperation(pool, { operationId, scope: options.scope, ttlSeconds: options.ttlSeconds, actorId });
        if (!reservation.ok)
            throw new common_1.ConflictException({ error: "Replay detected", reason: reservation.reason || "operation_replay", operationId });
        req.operationId = operationId;
        res.setHeader("x-operation-id", operationId);
        return next.handle();
    }
};
exports.ReplayGuardInterceptor = ReplayGuardInterceptor;
exports.ReplayGuardInterceptor = ReplayGuardInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService, core_1.Reflector])
], ReplayGuardInterceptor);
function UseReplayGuard(scope, ttlSeconds) {
    return function (target, key, descriptor) {
        (0, common_2.SetMetadata)("replayGuard", { scope, ttlSeconds })(target, key, descriptor);
        (0, common_1.UseInterceptors)(ReplayGuardInterceptor)(target, key, descriptor);
    };
}
function requireAdmin(req) {
    if (!req.user || String(req.user.role || "").toLowerCase() !== "admin") {
        throw new common_1.ForbiddenException({ error: "Admin role is required" });
    }
}
let CryptoController = class CryptoController {
    cryptoService;
    constructor(cryptoService) {
        this.cryptoService = cryptoService;
    }
    async getHealth() {
        return this.cryptoService.getHealth();
    }
    async createCommitment(req) {
        return this.cryptoService.createCommitment(req.operationId, req.body.domain, req.body.payload, req.body.payload_json);
    }
    async verifyCommitment(req) {
        return this.cryptoService.verifyCommitment(req.operationId, req.body.domain, req.body.commitment_sha3_256, req.body.payload, req.body.payload_json);
    }
    async createThresholdOperation(req, res) {
        requireAdmin(req);
        const result = await this.cryptoService.createThresholdOperation(Number(req.user.id), req.operationId, req.body);
        return res.status(common_1.HttpStatus.CREATED).json(result);
    }
    async approveThresholdOperation(req, id) {
        requireAdmin(req);
        return this.cryptoService.approveThresholdOperation(Number(req.user.id), req.operationId, id);
    }
    async executeThresholdOperation(req, id) {
        requireAdmin(req);
        return this.cryptoService.executeThresholdOperation(Number(req.user.id), id);
    }
    async getThresholdOperation(req, id) {
        requireAdmin(req);
        return this.cryptoService.getThresholdOperation(id);
    }
    async registerZkCircuit(req, res) {
        requireAdmin(req);
        const result = await this.cryptoService.registerZkCircuit(Number(req.user.id), req.body);
        return res.status(common_1.HttpStatus.CREATED).json(result);
    }
    async updateZkCircuitStatus(req, id) {
        requireAdmin(req);
        return this.cryptoService.updateZkCircuitStatus(id, req.body.status);
    }
    async generateZkProof(req, res) {
        const result = await this.cryptoService.generateZkProof(Number(req.user.id), req.operationId, req.body);
        return res.status(common_1.HttpStatus.CREATED).json(result);
    }
    async verifyZkProof(req, id) {
        return this.cryptoService.verifyZkProof(Number(req.user.id), req.operationId, id);
    }
    async getZkProof(req, id) {
        return this.cryptoService.getZkProof(id);
    }
    async createMpcSession(req, res) {
        requireAdmin(req);
        const result = await this.cryptoService.createMpcSession(Number(req.user.id), req.operationId, req.body);
        return res.status(common_1.HttpStatus.CREATED).json(result);
    }
    async signMpcSession(req, id) {
        requireAdmin(req);
        return this.cryptoService.signMpcSession(Number(req.user.id), req.operationId, id, req.body.partialSignature);
    }
    async finalizeMpcSession(req, id) {
        requireAdmin(req);
        return this.cryptoService.finalizeMpcSession(Number(req.user.id), req.operationId, id);
    }
    async getMpcSession(req, id) {
        requireAdmin(req);
        return this.cryptoService.getMpcSession(id);
    }
};
exports.CryptoController = CryptoController;
__decorate([
    (0, common_1.Get)("health"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "getHealth", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("commitment"),
    UseReplayGuard("crypto-commitment", 900),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "createCommitment", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("verify"),
    UseReplayGuard("crypto-verify", 900),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "verifyCommitment", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("threshold/operations"),
    UseReplayGuard("crypto-threshold-initiate", 3600),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "createThresholdOperation", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("threshold/operations/:id/approve"),
    UseReplayGuard("crypto-threshold-approve", 3600),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "approveThresholdOperation", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("threshold/operations/:id/execute"),
    UseReplayGuard("crypto-threshold-execute", 3600),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "executeThresholdOperation", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("threshold/operations/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "getThresholdOperation", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("zk/circuits/register"),
    UseReplayGuard("zk-circuit-register", 3600),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "registerZkCircuit", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("zk/circuits/:id/status"),
    UseReplayGuard("zk-circuit-status", 3600),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "updateZkCircuitStatus", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("zk/proofs/generate"),
    UseReplayGuard("zk-proof-generate", 1800),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "generateZkProof", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("zk/proofs/:id/verify"),
    UseReplayGuard("zk-proof-verify", 1800),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "verifyZkProof", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("zk/proofs/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "getZkProof", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("mpc/sessions"),
    UseReplayGuard("mpc-session-create", 3600),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "createMpcSession", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("mpc/sessions/:id/sign"),
    UseReplayGuard("mpc-session-sign", 3600),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "signMpcSession", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("mpc/sessions/:id/finalize"),
    UseReplayGuard("mpc-session-finalize", 3600),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "finalizeMpcSession", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("mpc/sessions/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CryptoController.prototype, "getMpcSession", null);
exports.CryptoController = CryptoController = __decorate([
    (0, common_1.Controller)("api/crypto"),
    __metadata("design:paramtypes", [crypto_service_1.CryptoService])
], CryptoController);
