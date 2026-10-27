import {
  Controller, Delete, Get,
  Param, ParseIntPipe, Put, Req, UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AccountsService } from "./accounts.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request {
  user?: Record<string, unknown>;
}

@Controller("api/accounts")
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  // Keep the fixed path before /:id so it remains routable after the Express 5
  // migration removes inline parameter-regex support.
  @UseGuards(JwtAuthGuard)
  @Put("preferences")
  async updatePreferences(@Req() req: AuthenticatedRequest) {
    const result = await this.accountsService.updatePreferences(Number(req.user?.id), req.body as Record<string, unknown>);
    return { message: "Preferences updated", ...result };
  }

  @UseGuards(JwtAuthGuard)
  @Get(":id")
  async getAccount(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    const account = await this.accountsService.getAccount(Number(req.user?.id), id);
    return { account };
  }

  @UseGuards(JwtAuthGuard)
  @Put(":id")
  async updateAccount(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    const { name, icon, username } = req.body as { name?: string; icon?: string; username?: string };
    const account = await this.accountsService.updateAccount(Number(req.user?.id), id, { name, icon, username });
    return { message: "Account updated", account };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(":id")
  async deleteAccount(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    await this.accountsService.deleteAccount(Number(req.user?.id), id);
    return { message: "Account deleted successfully" };
  }

  @UseGuards(JwtAuthGuard)
  @Put(":id/subscription")
  async updateSubscription(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    const { subscriptionId } = req.body as { subscriptionId?: number };
    const result = await this.accountsService.updateSubscription(Number(req.user?.id), id, Number(subscriptionId));
    return { message: "Subscription updated", subscription: result.subscription };
  }

  @UseGuards(JwtAuthGuard)
  @Get("preferences/:id")
  async getPreferences(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    return this.accountsService.getPreferences(Number(req.user?.id), id);
  }
}
