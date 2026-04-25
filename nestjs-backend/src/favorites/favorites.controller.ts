import {
  Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Post, Req, UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { FavoritesService } from "./favorites.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request { user?: Record<string, unknown>; }

@Controller("api/favorites")
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @UseGuards(JwtAuthGuard) @Get()
  async getFavorites(@Req() req: AuthenticatedRequest) {
    const favorites = await this.favoritesService.getFavorites(Number(req.user?.id));
    return { status: "success", favorites };
  }

  @UseGuards(JwtAuthGuard) @Post() @HttpCode(HttpStatus.CREATED)
  async addFavorite(@Req() req: AuthenticatedRequest) {
    await this.favoritesService.addFavorite(Number(req.user?.id), req.body as Record<string, unknown>);
    return { status: "success", message: "Added to favorites" };
  }

  @UseGuards(JwtAuthGuard) @Delete(":type/:id")
  async removeFavorite(@Req() req: AuthenticatedRequest, @Param("type") type: string, @Param("id") id: string) {
    await this.favoritesService.removeFavorite(Number(req.user?.id), type, id);
    return { status: "success", message: "Removed from favorites" };
  }

  @UseGuards(JwtAuthGuard) @Post("sync") @HttpCode(HttpStatus.OK)
  async syncFavorites(@Req() req: AuthenticatedRequest) {
    const { favorites } = req.body as { favorites?: unknown[] };
    await this.favoritesService.syncFavorites(Number(req.user?.id), favorites as Array<{ product_type: string; product_id: string; product_category?: string }>);
    return { status: "success", message: "Favorites synced successfully" };
  }
}
