import { Controller, Post, Get, Req, Res, UseGuards, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthComplexService } from "./auth-complex.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { setSessionCookie } from "../common/utils/session-cookie";
import { Throttle } from "@nestjs/throttler";
import { ruleFor } from "../config/rate-limit.policy";

interface AuthenticatedRequest extends Request {
  user?: Record<string, any>;
}

// The session token is delivered exclusively as an httpOnly cookie. Returning it
// in the response body as well would let any XSS read it back out of memory,
// which defeats the point of the cookie.
function withoutToken<T extends { token?: string }>(result: T): Omit<T, "token"> {
  const { token, ...rest } = result as T & { token?: string };
  return rest as Omit<T, "token">;
}

@Controller("api/auth")
export class AuthComplexController {
  constructor(private readonly authComplexService: AuthComplexService) {}

  @Throttle({ default: { limit: ruleFor("POST /api/auth/register").limit, ttl: ruleFor("POST /api/auth/register").ttlMs } })
  @Post("register")
  async register(@Req() req: Request, @Res() res: Response) {
    const result = await this.authComplexService.register(req);
    if ((result as any).token) {
      setSessionCookie(res, (result as any).token, req);
    }
    return res.status(HttpStatus.CREATED).json(withoutToken(result as any));
  }

  @Throttle({ default: { limit: ruleFor("POST /api/auth/login").limit, ttl: ruleFor("POST /api/auth/login").ttlMs } })
  @Post("login")
  async login(@Req() req: Request, @Res() res: Response) {
    const result = await this.authComplexService.login(req, res);
    if (!res.headersSent) {
      if ((result as any).status === "mfa_required") {
        return res.status(HttpStatus.ACCEPTED).json(withoutToken(result as any));
      }
      if ((result as any).token) {
        setSessionCookie(res, (result as any).token, req);
      }
      return res.status(HttpStatus.OK).json(withoutToken(result as any));
    }
  }

  @Throttle({ default: { limit: ruleFor("POST /api/auth/mfa").limit, ttl: ruleFor("POST /api/auth/mfa").ttlMs } })
  @Post("login/mfa-verify")
  async loginMfaVerify(@Req() req: Request, @Res() res: Response) {
    const result = await this.authComplexService.loginMfaVerify(req, res);
    if (!res.headersSent) {
      if ((result as any).token) {
        setSessionCookie(res, (result as any).token, req);
      }
      return res.status(HttpStatus.OK).json(withoutToken(result as any));
    }
  }

  @Post("refresh")
  async refresh(@Req() req: Request, @Res() res: Response) {
    const result = await this.authComplexService.refresh(req, res);
    if (!res.headersSent) {
      if ((result as any).token) {
        setSessionCookie(res, (result as any).token, req);
      }
      return res.status(HttpStatus.OK).json({
        ...withoutToken(result as any),
        expiresIn: (result as any).expiresIn,
      });
    }
  }

  @Get("verify-email")
  async verifyEmail(@Req() req: Request, @Res() res: Response) {
    await this.authComplexService.verifyEmail(req, res);
  }

  @UseGuards(JwtAuthGuard)
  @Post("verify-email/resend")
  async resendVerification(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const result = await this.authComplexService.resendVerification(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Get("oauth/:provider/start")
  async oauthStart(@Req() req: Request, @Res() res: Response) {
    await this.authComplexService.oauthStart(req, res);
  }

  @Get("oauth/:provider/callback")
  async oauthCallback(@Req() req: Request, @Res() res: Response) {
    await this.authComplexService.oauthCallback(req, res);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: ruleFor("POST /api/auth/mfa").limit, ttl: ruleFor("POST /api/auth/mfa").ttlMs } })
  @Post("mfa/setup")
  async mfaSetup(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const result = await this.authComplexService.mfaSetup(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: ruleFor("POST /api/auth/mfa").limit, ttl: ruleFor("POST /api/auth/mfa").ttlMs } })
  @Post("mfa/enable")
  async mfaEnable(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const result = await this.authComplexService.mfaEnable(req);
    return res.status(HttpStatus.OK).json(result);
  }
}
