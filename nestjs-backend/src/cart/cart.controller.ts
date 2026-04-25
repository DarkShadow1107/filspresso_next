import {
  Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseIntPipe, Post, Put, Req, UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CartService } from "./cart.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request { user?: Record<string, unknown>; }

@Controller("api/cart")
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @UseGuards(JwtAuthGuard) @Get()
  getCart(@Req() req: AuthenticatedRequest) {
    return this.cartService.getCart(Number(req.user?.id));
  }

  @UseGuards(JwtAuthGuard) @Post() @HttpCode(HttpStatus.CREATED)
  addItem(@Req() req: AuthenticatedRequest) {
    return this.cartService.addItem(Number(req.user?.id), req.body as Record<string, unknown>);
  }

  @UseGuards(JwtAuthGuard) @Put(":id")
  updateItem(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    const { quantity } = req.body as { quantity?: number };
    return this.cartService.updateItem(Number(req.user?.id), id, Number(quantity));
  }

  @UseGuards(JwtAuthGuard) @Delete(":id")
  removeItem(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    return this.cartService.removeItem(Number(req.user?.id), id);
  }

  @UseGuards(JwtAuthGuard) @Delete()
  clearCart(@Req() req: AuthenticatedRequest) {
    return this.cartService.clearCart(Number(req.user?.id));
  }
}
