import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { ActiveSessionService } from "./active-session.service";

interface AuthenticatedRequest extends Request {
	user?: { id?: number | string; email?: string; username?: string; [key: string]: unknown };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
	constructor(private readonly activeSessions: ActiveSessionService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const session = await this.activeSessions.resolve(request);

		if (!session) {
			throw new UnauthorizedException({ error: "Access token required" });
		}

		request.user = session.claims as AuthenticatedRequest["user"];
		return true;
	}
}
