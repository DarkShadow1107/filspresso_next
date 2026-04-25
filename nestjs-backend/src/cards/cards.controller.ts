import {
  Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseIntPipe, Post, Put, Req, UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CardsService } from "./cards.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request {
  user?: Record<string, unknown>;
}

@Controller("api/cards")
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async getCards(@Req() req: AuthenticatedRequest) {
    const cards = await this.cardsService.getCards(Number(req.user?.id));
    return { cards };
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addCard(@Req() req: AuthenticatedRequest) {
    const card = await this.cardsService.addCard(Number(req.user?.id), req.body as Record<string, unknown>);
    return { message: "Card added successfully", card };
  }

  @UseGuards(JwtAuthGuard)
  @Put(":id")
  async updateCard(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    await this.cardsService.updateCard(Number(req.user?.id), id, req.body as Record<string, unknown>);
    return { message: "Card updated successfully" };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(":id")
  async deleteCard(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    await this.cardsService.deleteCard(Number(req.user?.id), id);
    return { message: "Card deleted successfully" };
  }
}
