import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { RequestWithId } from "../middleware/request-id.middleware";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
	catch(exception: unknown, host: ArgumentsHost): void {
		const context = host.switchToHttp();
		const response = context.getResponse<Response>();
		const request = context.getRequest<RequestWithId>();

		let status = HttpStatus.INTERNAL_SERVER_ERROR;
		let error = "Internal server error";
		let details: unknown;

		if (exception instanceof HttpException) {
			status = exception.getStatus();
			const payload = exception.getResponse();

			if (typeof payload === "string") {
				error = payload;
			} else if (payload && typeof payload === "object") {
				const typedPayload = payload as Record<string, unknown>;
				if (typeof typedPayload.error === "string") {
					error = typedPayload.error;
				} else if (typeof typedPayload.message === "string") {
					error = typedPayload.message;
				}
				details = typedPayload;
			}
		} else if (exception instanceof Error) {
			error = exception.message;
		}

		const body: Record<string, unknown> = {
			error,
			requestId: request.requestId,
		};

		if (details !== undefined) {
			body.details = details;
		}

		if (process.env.NODE_ENV === "development" && exception instanceof Error) {
			body.stack = exception.stack;
		}

		// Phase 9 V4/V5. A route can legitimately send its response and then throw --
		// a `@Res()` handler that answers and continues, or an async continuation that
		// fails after res.json(). Writing here regardless threw ERR_HTTP_HEADERS_SENT
		// *from inside the exception filter*, which nothing else catches, so Node
		// treated it as an unhandled rejection and killed the process. That turned a
		// single bad request into a full outage: reproduced by stopping Redis, where a
		// burst of them took the backend down and Docker restarted it (RestartCount 1).
		//
		// Once headers are out, the status code is already whatever the route chose and
		// the client has its answer. The only correct action is to stop touching the
		// response. Log it, then return.
		if (response.headersSent) {
			const logger = new Logger(HttpExceptionFilter.name);
			logger.warn(
				`${request.method} ${request.url} raised ${exception?.constructor?.name || "an error"} after the response was already sent; not writing a second response`,
			);
			return;
		}

		response.status(status).json(body);
	}
}
