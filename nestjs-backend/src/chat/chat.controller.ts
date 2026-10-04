import {
  Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Post, Put, Query, Req, UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ChatService } from "./chat.service";
import {
  ChatHistoryService,
  type IncomingConversation,
} from "./chat-history.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request { user?: Record<string, unknown>; }

@Controller("api/chat")
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatHistory: ChatHistoryService,
  ) {}

  // ---------------------------------------------------------- history (bulk)

  /**
   * The browser's whole conversation list.
   *
   * Replaces `GET /api/chat/save`, which read one shared JSON file for every
   * visitor with no authentication at all. Same response shape, but scoped to the
   * authenticated account and served from Postgres.
   */
  @UseGuards(JwtAuthGuard)
  @Get("history")
  getHistory(@Req() req: AuthenticatedRequest) {
    return this.chatHistory.listHistory(Number(req.user?.["id"]));
  }

  @UseGuards(JwtAuthGuard)
  @Post("history")
  @HttpCode(HttpStatus.OK)
  replaceHistory(@Req() req: AuthenticatedRequest) {
    const body = (req.body ?? {}) as { history?: IncomingConversation[] };
    return this.chatHistory.replaceHistory(
      Number(req.user?.["id"]),
      Array.isArray(body.history) ? body.history : [],
      // The client-supplied tier is only used to pick the retention cap. It never
      // grants anything: entitlements are decided elsewhere, and an overstated
      // tier here would only leave more rows for the user to see, not grant access.
      typeof req.user?.["subscription"] === "string" ? req.user["subscription"] : null,
    );
  }

  // ---------------------------------------------------------------- sessions

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