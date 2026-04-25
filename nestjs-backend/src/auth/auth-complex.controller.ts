import { Controller, Post, Get, Req, Res, UseGuards, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthComplexService } from "./auth-complex.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

interface AuthenticatedRequest extends Request {
  user?: Record<string, any>;
}

@Controller("api/auth")
export class AuthComplexController {
  constructor(private readonly authComplexService: AuthComplexService) {}

  @Post("register")
  async register(@Req() req: Request, @Res() res: Response) {
    const result = await this.authComplexService.register(req);
    return res.status(HttpStatus.CREATED).json(result);
  }

  @Post("login")
  async login(@Req() req: Request, @Res() res: Response) {
    const result = await this.authComplexService.login(req, res);
    if (!res.headersSent) {
      if ((result as any).status === "mfa_required") {
        return res.status(HttpStatus.ACCEPTED).json(result);
      }
      return res.status(HttpStatus.OK).json(result);
    }
  }

  @Post("login/mfa-verify")
  async loginMfaVerify(@Req() req: Request, @Res() res: Response) {
    const result = await this.authComplexService.loginMfaVerify(req, res);
    if (!res.headersSent) {
      return res.status(HttpStatus.OK).json(result);
    }
  }

  @Post("refresh")
  async refresh(@Req() req: Request, @Res() res: Response) {
    const result = await this.authComplexService.refresh(req, res);
    if (!res.headersSent) {
      return res.status(HttpStatus.OK).json(result);
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
  @Post("mfa/setup")
  async mfaSetup(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const result = await this.authComplexService.mfaSetup(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @UseGuards(JwtAuthGuard)
  @Post("mfa/enable")
  async mfaEnable(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const result = await this.authComplexService.mfaEnable(req);
    return res.status(HttpStatus.OK).json(result);
  }
}
