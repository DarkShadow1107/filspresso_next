import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { verifyToken } from "../utils/auth-tokens";

interface AuthenticatedRequest extends Request {
  user?: Record<string, unknown>;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor() {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const authHeader = String(request.headers.authorization || "");

		if (!authHeader.startsWith("Bearer ")) {
			throw new UnauthorizedException({ error: "Access token required" });
		}

		const token = authHeader.slice(7).trim();
    const decoded = verifyToken(token);

		if (!decoded) {
			throw new UnauthorizedException({ error: "Invalid or expired token" });
		}

		request.user = decoded;
		return true;
	}
}
