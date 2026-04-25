import type { NextFunction, Request, Response } from "express";
import type { RequestWithId } from "./request-id.middleware";

export function createRequestTimeoutMiddleware(timeoutMs: number) {
	return (req: Request, res: Response, next: NextFunction) => {
		const request = req as RequestWithId;
		const timeout = setTimeout(() => {
			if (res.headersSent) return;
			res.status(503).json({
				error: "Request timed out",
				requestId: request.requestId,
			});
		}, timeoutMs);

		const clear = () => clearTimeout(timeout);
		res.on("finish", clear);
		res.on("close", clear);
		next();
	};
}
