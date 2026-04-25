import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { RepairsService } from "./repairs.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request { user?: Record<string, unknown>; }

@Controller("api/repairs")
export class RepairsController {
  constructor(private readonly repairsService: RepairsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getRepairs(@Req() req: AuthenticatedRequest) {
    return this.repairsService.getRepairs(Number(req.user?.["id"]));
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  submitRepair(@Req() req: AuthenticatedRequest) {
    return this.repairsService.submitRepair(
      Number(req.user?.["id"]),
      req.body as { machine_id?: string; machine_name?: string; repair_type?: string; is_warranty?: boolean; estimated_cost?: number; order_id?: number; payment_card_id?: number },
    );
  }
}
