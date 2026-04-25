import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type RequestWithId = Request & {
	requestId?: string;
};

function resolveRequestId(req: Request): string {
	const headerValue = String(req.headers["x-request-id"] || "").trim();
	const safeHeader = headerValue.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
	return safeHeader || randomUUID();
}

export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
	req.requestId = resolveRequestId(req);
	res.setHeader("x-request-id", req.requestId);
	next();
}
