import {
  Controller, Get, HttpCode, HttpStatus,
  Post, Put, Req, UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SubscriptionsService } from "./subscriptions.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request { user?: Record<string, unknown>; }

@Controller("api/subscriptions")
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @UseGuards(JwtAuthGuard) @Get()
  getSubscription(@Req() req: AuthenticatedRequest) {
    return this.subscriptionsService.getSubscription(Number(req.user?.id));
  }

  @UseGuards(JwtAuthGuard) @Post() @HttpCode(HttpStatus.CREATED)
  createSubscription(@Req() req: AuthenticatedRequest) {
    return this.subscriptionsService.createSubscription(Number(req.user?.id), req.body as Record<string, unknown>).then((s) => ({ message: "Subscription created successfully", subscription: s }));
  }

  @UseGuards(JwtAuthGuard) @Post("change") @HttpCode(HttpStatus.CREATED)
  changeSubscription(@Req() req: AuthenticatedRequest) {
    return this.subscriptionsService.changeSubscription(Number(req.user?.id), req.body as Record<string, unknown>);
  }

  @UseGuards(JwtAuthGuard) @Put("cancel") @HttpCode(HttpStatus.OK)
  cancelSubscription(@Req() req: AuthenticatedRequest) {
    return this.subscriptionsService.cancelSubscription(Number(req.user?.id));
  }

  @UseGuards(JwtAuthGuard) @Put("update-card") @HttpCode(HttpStatus.OK)
  updateCard(@Req() req: AuthenticatedRequest) {
    const { cardId } = req.body as { cardId?: number };
    return this.subscriptionsService.updateCard(Number(req.user?.id), Number(cardId));
  }

  @UseGuards(JwtAuthGuard) @Put("toggle-auto-renew") @HttpCode(HttpStatus.OK)
  toggleAutoRenew(@Req() req: AuthenticatedRequest) {
    return this.subscriptionsService.toggleAutoRenew(Number(req.user?.id));
  }
}
