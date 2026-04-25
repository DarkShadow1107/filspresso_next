import {
  Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Post, Put, Query, Req, UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ChatService } from "./chat.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request { user?: Record<string, unknown>; }

@Controller("api/chat")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @UseGuards(JwtAuthGuard)
  @Get("sessions")
  getSessions(
    @Req() req: AuthenticatedRequest,
    @Query("limit") limit: string,
    @Query("offset") offset: string,
  ) {
    return this.chatService.getSessions(
      Number(req.user?.["id"]),
      Number.parseInt(limit || "20", 10),
      Number.parseInt(offset || "0", 10),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get("sessions/:uuid")
  getSession(
    @Req() req: AuthenticatedRequest,
    @Param("uuid") uuid: string,
    @Query("messageLimit") messageLimit: string,
  ) {
    return this.chatService.getSession(
      Number(req.user?.["id"]), uuid,
      Number.parseInt(messageLimit || "50", 10),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post("sessions")
  @HttpCode(HttpStatus.CREATED)
  createSession(@Req() req: AuthenticatedRequest) {
    return this.chatService.createSession(
      Number(req.user?.["id"]),
      req.body as { title?: string; modelType?: string; aiEnabled?: boolean },
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post("sessions/:uuid/messages")
  @HttpCode(HttpStatus.CREATED)
  addMessage(@Req() req: AuthenticatedRequest, @Param("uuid") uuid: string) {
    return this.chatService.addMessage(
      Number(req.user?.["id"]), uuid,
      req.body as { role?: string; content?: string; tokensUsed?: number; responseTimeMs?: number },
    );
  }

  @UseGuards(JwtAuthGuard)
  @Put("sessions/:uuid")
  updateSession(@Req() req: AuthenticatedRequest, @Param("uuid") uuid: string) {
    return this.chatService.updateSession(
      Number(req.user?.["id"]), uuid,
      req.body as { title?: string; modelType?: string; aiEnabled?: boolean },
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete("sessions/:uuid")
  deleteSession(@Req() req: AuthenticatedRequest, @Param("uuid") uuid: string) {
    return this.chatService.deleteSession(Number(req.user?.["id"]), uuid);
  }
}
