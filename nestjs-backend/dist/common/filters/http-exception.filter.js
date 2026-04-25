"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
let HttpExceptionFilter = class HttpExceptionFilter {
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
        response.status(status).json(body);
    }
};
exports.HttpExceptionFilter = HttpExceptionFilter;
exports.HttpExceptionFilter = HttpExceptionFilter = __decorate([
    (0, common_1.Catch)()
], HttpExceptionFilter);
