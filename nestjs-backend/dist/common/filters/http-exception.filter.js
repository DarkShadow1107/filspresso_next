"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var HttpExceptionFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
let HttpExceptionFilter = HttpExceptionFilter_1 = class HttpExceptionFilter {
    catch(exception, host) {
        const context = host.switchToHttp();
        const response = context.getResponse();
        const request = context.getRequest();
        let status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        let error = "Internal server error";
        let details;
        if (exception instanceof common_1.HttpException) {
            status = exception.getStatus();
            const payload = exception.getResponse();
            if (typeof payload === "string") {
                error = payload;
            }
            else if (payload && typeof payload === "object") {
                const typedPayload = payload;
                if (typeof typedPayload.error === "string") {
                    error = typedPayload.error;
                }
                else if (typeof typedPayload.message === "string") {
                    error = typedPayload.message;
                }
                details = typedPayload;
            }
        }
        else if (exception instanceof Error) {
            error = exception.message;
        }
        const body = {
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
            const logger = new common_1.Logger(HttpExceptionFilter_1.name);
            logger.warn(`${request.method} ${request.url} raised ${exception?.constructor?.name || "an error"} after the response was already sent; not writing a second response`);
            return;
        }
        response.status(status).json(body);
    }
};
exports.HttpExceptionFilter = HttpExceptionFilter;
exports.HttpExceptionFilter = HttpExceptionFilter = HttpExceptionFilter_1 = __decorate([
    (0, common_1.Catch)()
], HttpExceptionFilter);
