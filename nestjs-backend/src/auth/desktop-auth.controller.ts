import { Controller, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthComplexService } from "./auth-complex.service";
import { ruleFor } from "../config/rate-limit.policy";
import { Throttle } from "@nestjs/throttler";

/**
 * The desktop client's credential endpoints.
 *
 * A separate controller rather than two more routes on `auth-complex.controller.ts`,
 * because these are the only auth routes on the service that return a credential in the
 * response body. Keeping them together makes that fact obvious to anyone auditing the
 * auth surface, which is the point: the one exception to the cookie-only rule should be
 * findable in a single glance, not spread across a file that also sets cookies.
 *
 * Neither route sets a cookie. A desktop client has no cookie jar, and quietly handing it
 * one would leave a second, unnoticed credential path in the app.
 */
@Controller("api/auth/desktop")
export class DesktopAuthController {
  constructor(private readonly authComplexService: AuthComplexService) {}

  /**
   * Password, and MFA in one call.
   *
   * 202 with `requiresMfa` and a `challengeToken` when the account has MFA and no code was
   * sent, matching the web login's shape so the client has one MFA state to handle rather
   * than two.
   *
   * Throttled on its own budget, keyed per account+device rather than per IP. The reason
   * is in rate-limit.policy.ts: the web limit of 10 logins per 15 minutes is per IP, so a
   * whole office behind one NAT shares it and one person's typo loop locks out everyone.
   * This is a narrower budget for a narrower route -- a device grant is rarer than a page
   * load, and it is the one an attacker would script.
   */
  @Throttle({ default: { limit: ruleFor("POST /api/auth/desktop/token").limit, ttl: ruleFor("POST /api/auth/desktop/token").ttlMs } })
  @Post("token")
  async token(@Req() req: Request, @Res() res: Response) {
    const result = (await this.authComplexService.desktopTokenGrant(req)) as { status?: string };
    // The status is set explicitly in both branches rather than left to Nest's POST default
    // of 201. Nothing here creates a resource addressable at a URL: it returns a credential,
    // and a client that reads 201 as "created, and here is where to GET it" will look for
    // one that does not exist.
    res.status(result?.status === "mfa_required" ? HttpStatus.ACCEPTED : HttpStatus.OK);
    res.json(result);
  }

  /**
   * Rotate both credentials.
   *
   * Given its own, looser budget than the grant. A 15-minute access token means a desktop
   * app legitimately refreshes on a timer, several times an hour, and that must not be
   * indistinguishable from password guessing -- but it must not be *unlimited* either, so
   * this stays a ceiling rather than being skipped.
   */
  @Throttle({ default: { limit: ruleFor("POST /api/auth/desktop/refresh").limit, ttl: ruleFor("POST /api/auth/desktop/refresh").ttlMs } })
  @Post("refresh")
  async refresh(@Req() req: Request, @Res() res: Response) {
    // 200 explicitly, for the same reason as the grant: a rotated credential is not a
    // created resource, and a client that special-cases 201 will get it wrong here.
    const result = await this.authComplexService.desktopTokenRefresh(req);
    res.status(HttpStatus.OK);
    res.json(result);
  }
}
