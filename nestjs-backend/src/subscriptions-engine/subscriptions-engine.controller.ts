import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SubscriptionsEngineService } from "./subscriptions-engine.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request { user?: Record<string, unknown>; }

@Controller("api/subscriptions-engine")
export class SubscriptionsEngineController {
  constructor(private readonly engineService: SubscriptionsEngineService) {}

  @Get("health")
  getHealth() { return this.engineService.getHealth(); }

  @UseGuards(JwtAuthGuard)
  @Post("quote")
  @HttpCode(HttpStatus.OK)
  getQuote(@Req() req: AuthenticatedRequest) {
    return this.engineService.getQuote(req.user ?? {}, req.body as Record<string, unknown>);
  }
}
