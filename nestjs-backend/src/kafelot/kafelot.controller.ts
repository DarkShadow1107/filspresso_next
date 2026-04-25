import { Controller, Get, Post, Put, Param, Query, Req, Res, UseGuards, ParseIntPipe, HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { KafelotService, normalizeUsageScope, USAGE_SCOPES } from "./kafelot.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../common/guards/optional-jwt-auth.guard";
import * as net from "net";

interface AuthenticatedRequest extends Request { user?: Record<string, any>; }

function normalizeClientIp(value: any): string | null {
  if (!value) return null;
  let candidate = Array.isArray(value) ? String(value[0] || "") : String(value).split(",")[0].trim();
  candidate = candidate.replace(/^"|"$/g, "").trim();
  if (!candidate) return null;
  if (candidate.startsWith("[") && candidate.includes("]")) candidate = candidate.slice(1, candidate.indexOf("]")).trim();
  const mappedIpv4Match = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mappedIpv4Match && net.isIP(mappedIpv4Match[1]) === 4) return mappedIpv4Match[1];
  if (net.isIP(candidate)) return candidate;
  const ipv4WithPortMatch = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPortMatch && net.isIP(ipv4WithPortMatch[1]) === 4) return ipv4WithPortMatch[1];
  return null;
}

function getClientIp(req: Request): string | null {
  return normalizeClientIp(req.headers["cf-connecting-ip"]) ||
         normalizeClientIp(req.headers["x-real-ip"]) ||
         normalizeClientIp(req.headers["x-forwarded-for"]) ||
         normalizeClientIp(req.ip) ||
         normalizeClientIp(req.socket?.remoteAddress) || null;
}

function resolveUsageScope(req: Request): string {
  const bodyScope = req.body && typeof req.body === "object" ? req.body.scope : undefined;
  const headerScope = req.headers["x-kafelot-scope"];
  const queryScope = req.query?.scope;
  return normalizeUsageScope((bodyScope || headerScope || queryScope || USAGE_SCOPES.GENERAL) as string);
}

@Controller("api/kafelot")
export class KafelotController {
  constructor(private readonly kafelotService: KafelotService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Post("check-and-use")
  async checkAndUse(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const fingerprint = req.headers["x-kafelot-fingerprint"] as string | undefined;
    const hasBearerToken = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
    const ip = getClientIp(req);
    const userAgent = (req.headers["user-agent"] as string) || "";
    const systemInfo = req.body?.system_info || {};
    const dryRun = req.body?.dry_run === true;
    const usageScope = resolveUsageScope(req);
    
    if (hasBearerToken && !req.user) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "AUTH_SESSION_INVALID", message: "Authentication session expired or invalid" });
    }

    const result = await this.kafelotService.checkAndUse({
      accountId: req.user?.id, fingerprint, ip, userAgent, systemInfo, dryRun, usageScope, hasBearerToken
    });
    return res.status(result.status).json(result.data);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get("status")
  async getStatus(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const fingerprint = req.headers["x-kafelot-fingerprint"] as string | undefined;
    const hasBearerToken = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
    const ip = getClientIp(req);
    const userAgent = (req.headers["user-agent"] as string) || "";
    const usageScope = resolveUsageScope(req);

    if (hasBearerToken && !req.user) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "AUTH_SESSION_INVALID", message: "Authentication session expired or invalid" });
    }

    const result = await this.kafelotService.getStatus({
      accountId: req.user?.id, fingerprint, ip, userAgent, usageScope, hasBearerToken
    });
    return res.status(result.status).json(result.data);
  }

  @UseGuards(JwtAuthGuard)
  @Get("anonymous")
  getAnonymousUsers(@Req() req: AuthenticatedRequest, @Query("limit") limit: string, @Query("offset") offset: string, @Query("search") search: string, @Res() res: Response) {
    if (req.user?.role !== "admin") return res.status(HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
    return this.kafelotService.getAnonymousUsers(Number.parseInt(limit || "50", 10), Number.parseInt(offset || "0", 10), search || "").then(r => res.json(r));
  }

  @UseGuards(JwtAuthGuard)
  @Put("anonymous/:id")
  updateAnonymousUser(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number, @Res() res: Response) {
    if (req.user?.role !== "admin") return res.status(HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
    return this.kafelotService.updateAnonymousUser(id, req.body.prompts_limit, req.body.prompts_used).then(r => res.json(r)).catch(e => {
        if (e.status === 404) return res.status(404).json({ error: "Not found" });
        return res.status(500).json({ error: "Internal server error" });
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get("users")
  getUsersUsage(@Req() req: AuthenticatedRequest, @Query("limit") limit: string, @Query("offset") offset: string, @Query("month_year") monthYear: string, @Query("scope") scope: string, @Res() res: Response) {
    if (req.user?.role !== "admin") return res.status(HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
    return this.kafelotService.getUsersUsage(Number.parseInt(limit || "50", 10), Number.parseInt(offset || "0", 10), monthYear, scope).then(r => res.json(r));
  }

  @UseGuards(JwtAuthGuard)
  @Put("users/:id")
  updateUserUsage(@Req() req: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number, @Res() res: Response) {
    if (req.user?.role !== "admin") return res.status(HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
    return this.kafelotService.updateUserUsage(id, req.body.prompts_limit, req.body.prompts_used).then(r => res.json(r)).catch(e => {
        if (e.status === 404) return res.status(404).json({ error: "Not found" });
        return res.status(500).json({ error: "Internal server error" });
    });
  }
}
