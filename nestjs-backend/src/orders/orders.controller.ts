import {
  Controller, Get, Post, Put, Param, ParseIntPipe,
  Query, Req, Res, HttpCode, HttpStatus, UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { OrdersService } from "./orders.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request { user?: Record<string, unknown>; }

@Controller("api/orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // Public
  @Get("popular")
  getPopular(@Query("limit") limit: string) {
    return this.ordersService.getPopularProducts(Number.parseInt(limit || "5", 10));
  }

  // Authenticated
  @UseGuards(JwtAuthGuard)
  @Get("machines")
  getMachines(@Req() req: AuthenticatedRequest) {
    return this.ordersService.getUserMachines(Number(req.user?.["id"]));
  }

  @UseGuards(JwtAuthGuard)
  @Get("spending")
  getSpending(@Req() req: AuthenticatedRequest) {
    return this.ordersService.getUserSpending(Number(req.user?.["id"]));
  }

  @UseGuards(JwtAuthGuard)
  @Get("capsule-stats")
  getCapsuleStats(@Req() req: AuthenticatedRequest) {
    return this.ordersService.getCapsuleStats(Number(req.user?.["id"]));
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  getOrders(@Req() req: AuthenticatedRequest) {
    return this.ordersService.getUserOrders(Number(req.user?.["id"]));
  }

  @UseGuards(JwtAuthGuard)
  @Get(":id")
  getOrder(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    return this.ordersService.getOrder(Number(req.user?.["id"]), id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createOrder(@Req() req: AuthenticatedRequest) {
    return this.ordersService.createOrder(Number(req.user?.["id"]), req.body as Record<string, unknown>);
  }

  @UseGuards(JwtAuthGuard)
  @Put(":id/status")
  updateStatus(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    const { status } = req.body as { status?: string };
    const isAdmin = String(req.user?.["role"] || "").toLowerCase() === "admin";
    return this.ordersService.updateOrderStatus(Number(req.user?.["id"]), id, String(status || ""), isAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Get(":id/invoice")
  async getInvoice(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const pdfBuffer = await this.ordersService.getOrderInvoice(Number(req.user?.["id"]), id);
    if (!pdfBuffer) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ error: "Invoice generation failed" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${id}.pdf"`);
    res.send(pdfBuffer);
  }
}
