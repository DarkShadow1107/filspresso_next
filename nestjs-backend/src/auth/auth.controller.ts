import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { clearSessionCookie, readSessionToken } from "../common/utils/session-cookie";

interface AuthenticatedRequest extends Request {
  user?: Record<string, unknown>;
}

/**
 * AuthController — owns /api/auth/* routes.
 *
 * The legacy Express delegation for auth is gone: `src/legacy/` was deleted in
 * 615a690, so there is no passthrough router left to delegate to. Every
 * /api/auth route below is implemented natively in NestJS.
 *
 * Complex auth surface (implemented here, no legacy passthrough):
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   GET  /api/auth/oauth/:provider/start
 *   GET  /api/auth/oauth/:provider/callback
 *   GET  /api/auth/verify-email
 *   POST /api/auth/mfa/setup
 *   POST /api/auth/mfa/verify-setup
 *   POST /api/auth/mfa/challenge
 *   POST /api/auth/mfa/verify
 *
 * NestJS-owned:
 *   GET  /api/auth/me
 *   POST /api/auth/logout
 *   GET  /api/auth/sessions
 *   DELETE /api/auth/sessions/:id
 *   PUT  /api/auth/change-password
 *   PUT  /api/auth/change-email
 *   GET  /api/auth/security-events
 *   GET  /api/auth/mfa/status
 *   POST /api/auth/mfa/disable
 *   GET  /api/auth/.well-known/openid-configuration
 *   GET  /api/auth/.well-known/jwks.json
 */
@Controller("api/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ------------------------------------------------------------------ OIDC

  @Get(".well-known/openid-configuration")
  getOpenIdConfiguration(@Req() req: Request): Record<string, unknown> {
    if (!this.authService.getOidcAvailability()) {
      throw new ServiceUnavailableException({
        status: "error",
        message: "OIDC discovery is unavailable because JWT signing keys are not configured",
      });
    }
    const baseUrl = this.resolveBaseUrl(req);
    return this.authService.getOpenIdConfiguration(baseUrl);
  }

  @Get(".well-known/jwks.json")
  getJwks(): Record<string, unknown> {
    if (!this.authService.getOidcAvailability()) {
      throw new ServiceUnavailableException({
        status: "error",
        message: "JWKS is unavailable because JWT signing keys are not configured",
      });
    }
    return this.authService.getJwks();
  }

  // ------------------------------------------------------------------ Me

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async getMe(@Req() req: AuthenticatedRequest): Promise<Record<string, unknown>> {
    const accountId = Number(req.user?.id);
    const user = await this.authService.getMe(accountId);
    return { user };
  }

  // ------------------------------------------------------------------ Sessions

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<{ message: string }> {
    const token = readSessionToken(req);
    if (token) {
      await this.authService.invalidateSession(token);
    }
    clearSessionCookie(res, req);
    return { message: "Logged out successfully" };
  }

  @UseGuards(JwtAuthGuard)
  @Get("sessions")
  async getSessions(@Req() req: AuthenticatedRequest): Promise<{ sessions: unknown[] }> {
    const accountId = Number(req.user?.id);
    const sessions = await this.authService.getSessions(accountId);
    return { sessions };
  }

  @UseGuards(JwtAuthGuard)
  @Delete("sessions/:id")
  async revokeSession(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseIntPipe) sessionId: number,
  ): Promise<{ message: string }> {
    const accountId = Number(req.user?.id);
    await this.authService.revokeSession(accountId, sessionId);
    return { message: "Session revoked" };
  }

  // ------------------------------------------------------------------ Password / Email

  @UseGuards(JwtAuthGuard)
  @Put("change-password")
  async changePassword(@Req() req: AuthenticatedRequest): Promise<{ message: string }> {
    const accountId = Number(req.user?.id);
    const { oldPassword, newPassword } = req.body as {
      oldPassword?: string;
      newPassword?: string;
    };
    await this.authService.changePassword(
      accountId,
      String(oldPassword || ""),
      String(newPassword || ""),
    );
    return { message: "Password changed successfully" };
  }

  @UseGuards(JwtAuthGuard)
  @Put("change-email")
  async changeEmail(@Req() req: AuthenticatedRequest): Promise<{ message: string }> {
    const accountId = Number(req.user?.id);
    const { email } = req.body as { email?: string };
    await this.authService.changeEmail(accountId, String(email || ""));
    return { message: "Email updated. Please verify your new email address." };
  }

  // ------------------------------------------------------------------ Security events

  @UseGuards(JwtAuthGuard)
  @Get("security-events")
  async getSecurityEvents(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ events: unknown[] }> {
    const accountId = Number(req.user?.id);
    const rawLimit = Number.parseInt(
      String(req.query["limit"] || "20"),
      10,
    );
    const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
    const events = await this.authService.getSecurityEvents(accountId, limit);
    return { events };
  }

  // ------------------------------------------------------------------ MFA

  @UseGuards(JwtAuthGuard)
  @Get("mfa/status")
  async getMfaStatus(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ enabled: boolean }> {
    const accountId = Number(req.user?.id);
    return this.authService.getMfaStatus(accountId);
  }

  @UseGuards(JwtAuthGuard)
  @Post("mfa/disable")
  @HttpCode(HttpStatus.OK)
  async disableMfa(@Req() req: AuthenticatedRequest): Promise<{ message: string }> {
    const accountId = Number(req.user?.id);
    const { password } = req.body as { password?: string };
    await this.authService.disableMfa(accountId, String(password || ""));
    return { message: "MFA disabled successfully" };
  }

  // ------------------------------------------------------------------ Helpers

  private resolveBaseUrl(req: Request): string {
    const configured = String(process.env.BACKEND_PUBLIC_URL || "").trim();
    if (configured) return configured.replace(/\/$/, "");
    const protocol =
      String(req.headers["x-forwarded-proto"] || req.protocol || "http")
        .split(",")[0]
        .trim() || "http";
    const host =
      String(req.headers["x-forwarded-host"] || req.headers.host || "localhost:4000")
        .split(",")[0]
        .trim() || "localhost:4000";
    return `${protocol}://${host}`.replace(/\/$/, "");
  }
}
