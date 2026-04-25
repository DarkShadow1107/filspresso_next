import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
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

		response.status(status).json(body);
	}
}
