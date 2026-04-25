import {
  Controller, Get, Post, Req, Res, UseGuards, HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { OperationsService } from "./operations.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { UseReplayGuard } from "../crypto/crypto.controller";

interface AuthenticatedRequest extends Request { user?: Record<string, unknown>; operationId?: string; }

@Controller("api/operations")
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get("health")
  async healthCheck() {
    return this.operationsService.healthCheck();
  }

  @UseGuards(JwtAuthGuard)
  @Post("events")
  @UseReplayGuard("ops-events", 900)
  async ingestEvent(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const operationId = req.operationId!;
    const body = req.body as { eventType?: string; payload?: Record<string, unknown> };
    const result = await this.operationsService.ingestEvent(Number(req.user?.id), operationId, body);
    res.status(HttpStatus.ACCEPTED).json(result);
  }
}
