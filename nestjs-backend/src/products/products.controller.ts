import {
  Controller, Delete, Get, HttpCode, HttpStatus, Param,
  Post, Put, Req, UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ProductsService } from "./products.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request { user?: Record<string, unknown>; }

@Controller("api/products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get("coffee")
  getCoffeeProducts() { return this.productsService.getCoffeeProducts(); }

  @Get("coffee/:productId")
  getCoffeeProduct(@Param("productId") productId: string) {
    return this.productsService.getCoffeeProduct(productId);
  }

  @Get("machines")
  getMachineProducts() { return this.productsService.getMachineProducts(); }

  @Get("machines/:productId")
  getMachineProduct(@Param("productId") productId: string) {
    return this.productsService.getMachineProduct(productId);
  }

  @UseGuards(JwtAuthGuard)
  @Put("coffee/:productId/stock")
  updateCoffeeStock(@Param("productId") productId: string, @Req() req: AuthenticatedRequest) {
    this.productsService.assertAdmin(req.user ?? {});
    const { stock } = req.body as { stock?: number };
    return this.productsService.updateCoffeeStock(productId, Number(stock));
  }

  @UseGuards(JwtAuthGuard)
  @Put("machines/:productId/stock")
  updateMachineStock(@Param("productId") productId: string, @Req() req: AuthenticatedRequest) {
    this.productsService.assertAdmin(req.user ?? {});
    const { stock } = req.body as { stock?: number };
    return this.productsService.updateMachineStock(productId, Number(stock));
  }

  @UseGuards(JwtAuthGuard)
  @Post("decrease-stock")
  @HttpCode(HttpStatus.OK)
  decreaseStock(@Req() req: AuthenticatedRequest) {
    this.productsService.assertAdmin(req.user ?? {});
    const { items } = req.body as { items?: Array<{ productId: string; quantity: number; type?: string }> };
    return this.productsService.decreaseStock(items ?? []);
  }

  @UseGuards(JwtAuthGuard)
  @Post("sync")
  @HttpCode(HttpStatus.OK)
  syncProducts(@Req() req: AuthenticatedRequest) {
    this.productsService.assertAdmin(req.user ?? {});
    return this.productsService.syncProducts(req.body as { coffeeProducts?: unknown[]; machineProducts?: unknown[] });
  }

  @UseGuards(JwtAuthGuard)
  @Post("coffee/reset-static")
  @HttpCode(HttpStatus.OK)
  resetCoffeeStatic(@Req() req: AuthenticatedRequest) {
    this.productsService.assertAdmin(req.user ?? {});
    return this.productsService.resetCoffeeStatic();
  }

  @UseGuards(JwtAuthGuard)
  @Delete("coffee/:productId")
  deleteCoffeeProduct(@Req() req: AuthenticatedRequest, @Param("productId") productId: string) {
    this.productsService.assertAdmin(req.user ?? {});
    return { status: "success", productId, message: "Product deletion handled by admin module" };
  }
}
