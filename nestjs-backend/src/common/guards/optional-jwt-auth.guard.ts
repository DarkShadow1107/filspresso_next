import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { verifyToken } from "../utils/auth-tokens";

interface AuthenticatedRequest extends Request {
	user?: { id?: number | string; email?: string; username?: string; [key: string]: unknown };
}

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
	constructor() {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const authHeader = String(request.headers.authorization || "");

		if (authHeader.startsWith("Bearer ")) {
			const token = authHeader.slice(7).trim();
			const decoded = verifyToken(token);

			if (decoded) {
				request.user = decoded as AuthenticatedRequest["user"];
			}
		}

		return true; // Always allow, just populate user if token is valid
	}
}
