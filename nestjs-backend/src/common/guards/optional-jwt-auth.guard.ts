import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { ActiveSessionService } from "./active-session.service";

interface AuthenticatedRequest extends Request {
	user?: { id?: number | string; email?: string; username?: string; [key: string]: unknown };
}

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
	constructor(private readonly activeSessions: ActiveSessionService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

		// A revoked or expired session is treated exactly like no session at all,
		// so protected routes fall back to their anonymous behaviour.
		const session = await this.activeSessions.resolve(request);
		if (session) {
			request.user = session.claims as AuthenticatedRequest["user"];
		}

		return true; // Always allow, just populate user if the session is live
	}
}
