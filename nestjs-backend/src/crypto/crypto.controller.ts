import { Controller, Get, Post, Param, Req, Res, UseGuards, HttpStatus, ParseIntPipe, ConflictException, ForbiddenException, BadRequestException, Injectable, ExecutionContext, CallHandler, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";
import { CryptoService } from "./crypto.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { Observable } from "rxjs";
import * as crypto from "crypto";

interface AuthenticatedRequest extends Request {
  user?: Record<string, any>;
  operationId?: string;
}

import * as replayGuard from "../common/utils/replayGuard";
import { DatabaseService } from "../database/database.service";
import { SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

const REPLAY_GUARD_STRICT_REQUIRED = String(process.env.OPERATION_REPLAY_REQUIRE_ID || "false").trim().toLowerCase() === "true";

@Injectable()
export class ReplayGuardInterceptor {
  constructor(private readonly db: DatabaseService, private readonly reflector: Reflector) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<AuthenticatedRequest>();
    const res = ctx.getResponse<Response>();

    const options = this.reflector.get<{scope: string; ttlSeconds: number}>("replayGuard", context.getHandler());
    if (!options) return next.handle();

    const providedOperationId = replayGuard.extractOperationId(req);
    const normalizedProvided = replayGuard.normalizeOperationId(providedOperationId);

    if (providedOperationId && !normalizedProvided) throw new BadRequestException({ error: "Invalid operation id", reason: "operation_id_format_invalid" });

    let operationId = normalizedProvided;
    if (!operationId) {
      if (REPLAY_GUARD_STRICT_REQUIRED) throw new BadRequestException({ error: "Operation id is required", reason: "operation_id_missing" });
      operationId = `op_${crypto.randomUUID().replace(/-/g, "")}`;
    }

    let actorId = "anonymous";
    if (req.user?.id) actorId = `user:${req.user.id}`;
    else if (req.ip) actorId = `ip:${String(req.ip).slice(0, 64)}`;

    const pool = this.db.getPool();
    const reservation = await replayGuard.reserveReplayOperation(pool, { operationId, scope: options.scope, ttlSeconds: options.ttlSeconds, actorId });

    if (!reservation.ok) throw new ConflictException({ error: "Replay detected", reason: reservation.reason || "operation_replay", operationId });

    req.operationId = operationId;
    res.setHeader("x-operation-id", operationId);
    
    return next.handle();
  }
}

export function UseReplayGuard(scope: string, ttlSeconds: number) {
  return function (target: any, key: string, descriptor: PropertyDescriptor) {
    SetMetadata("replayGuard", { scope, ttlSeconds })(target, key, descriptor);
    UseInterceptors(ReplayGuardInterceptor)(target, key, descriptor);
  };
}

function requireAdmin(req: AuthenticatedRequest) {
  if (!req.user || String(req.user.role || "").toLowerCase() !== "admin") {
    throw new ForbiddenException({ error: "Admin role is required" });
  }
}

@Controller("api/crypto")
export class CryptoController {
  constructor(private readonly cryptoService: CryptoService) {}

  @Get("health")
  async getHealth() {
    return this.cryptoService.getHealth();
  }

  @UseGuards(JwtAuthGuard)
  @Post("commitment")
  @UseReplayGuard("crypto-commitment", 900)
  async createCommitment(@Req() req: AuthenticatedRequest) {
    return this.cryptoService.createCommitment(req.operationId!, req.body.domain, req.body.payload, req.body.payload_json);
  }

  @UseGuards(JwtAuthGuard)
  @Post("verify")
  @UseReplayGuard("crypto-verify", 900)
  async verifyCommitment(@Req() req: AuthenticatedRequest) {
    return this.cryptoService.verifyCommitment(req.operationId!, req.body.domain, req.body.commitment_sha3_256, req.body.payload, req.body.payload_json);
  }

  @UseGuards(JwtAuthGuard)
  @Post("threshold/operations")
  @UseReplayGuard("crypto-threshold-initiate", 3600)
  async createThresholdOperation(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    requireAdmin(req);
    const result = await this.cryptoService.createThresholdOperation(Number(req.user!.id), req.operationId!, req.body);
    return res.status(HttpStatus.CREATED).json(result);
  }

  @UseGuards(JwtAuthGuard)
  @Post("threshold/operations/:id/approve")
  @UseReplayGuard("crypto-threshold-approve", 3600)
  async approveThresholdOperation(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    requireAdmin(req);
    return this.cryptoService.approveThresholdOperation(Number(req.user!.id), req.operationId!, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post("threshold/operations/:id/execute")
  @UseReplayGuard("crypto-threshold-execute", 3600)
  async executeThresholdOperation(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    requireAdmin(req);
    return this.cryptoService.executeThresholdOperation(Number(req.user!.id), id);
  }

  @UseGuards(JwtAuthGuard)
  @Get("threshold/operations/:id")
  async getThresholdOperation(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    requireAdmin(req);
    return this.cryptoService.getThresholdOperation(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post("zk/circuits/register")
  @UseReplayGuard("zk-circuit-register", 3600)
  async registerZkCircuit(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    requireAdmin(req);
    const result = await this.cryptoService.registerZkCircuit(Number(req.user!.id), req.body);
    return res.status(HttpStatus.CREATED).json(result);
  }

  @UseGuards(JwtAuthGuard)
  @Post("zk/circuits/:id/status")
  @UseReplayGuard("zk-circuit-status", 3600)
  async updateZkCircuitStatus(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    requireAdmin(req);
    return this.cryptoService.updateZkCircuitStatus(id, req.body.status);
  }

  @UseGuards(JwtAuthGuard)
  @Post("zk/proofs/generate")
  @UseReplayGuard("zk-proof-generate", 1800)
  async generateZkProof(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const result = await this.cryptoService.generateZkProof(Number(req.user!.id), req.operationId!, req.body);
    return res.status(HttpStatus.CREATED).json(result);
  }

  @UseGuards(JwtAuthGuard)
  @Post("zk/proofs/:id/verify")
  @UseReplayGuard("zk-proof-verify", 1800)
  async verifyZkProof(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    return this.cryptoService.verifyZkProof(Number(req.user!.id), req.operationId!, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get("zk/proofs/:id")
  async getZkProof(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    return this.cryptoService.getZkProof(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post("mpc/sessions")
  @UseReplayGuard("mpc-session-create", 3600)
  async createMpcSession(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    requireAdmin(req);
    const result = await this.cryptoService.createMpcSession(Number(req.user!.id), req.operationId!, req.body);
    return res.status(HttpStatus.CREATED).json(result);
  }

  @UseGuards(JwtAuthGuard)
  @Post("mpc/sessions/:id/sign")
  @UseReplayGuard("mpc-session-sign", 3600)
  async signMpcSession(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    requireAdmin(req);
    return this.cryptoService.signMpcSession(Number(req.user!.id), req.operationId!, id, req.body.partialSignature);
  }

  @UseGuards(JwtAuthGuard)
  @Post("mpc/sessions/:id/finalize")
  @UseReplayGuard("mpc-session-finalize", 3600)
  async finalizeMpcSession(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    requireAdmin(req);
    return this.cryptoService.finalizeMpcSession(Number(req.user!.id), req.operationId!, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get("mpc/sessions/:id")
  async getMpcSession(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    requireAdmin(req);
    return this.cryptoService.getMpcSession(id);
  }
}
