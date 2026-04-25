"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpaPolicyService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let OpaPolicyService = class OpaPolicyService {
    configService;
    constructor(configService) {
        this.configService = configService;
    }
    async evaluate(input) {
        const opaUrl = String(this.configService.get("opa.url") || "").trim();
        if (!opaUrl) {
            return { allow: true, reason: "opa_disabled" };
        }
        const timeoutMs = Number(this.configService.get("opa.timeoutMs") || 1500);
        const failClosed = Boolean(this.configService.get("opa.failClosed") || false);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(opaUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    input: {
                        resource: input.resource,
                        action: input.action,
                        method: input.method,
                        path: input.path,
                        ip_address: input.ipAddress,
                        request_id: input.requestId,
                        identity: input.identity,
                    },
                }),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`OPA returned ${response.status}`);
            }
            const data = (await response.json());
            const result = data?.result;
            if (typeof result === "boolean") {
                return { allow: result, reason: "opa_boolean_result" };
            }
            if (result && typeof result === "object") {
                const typedResult = result;
                return {
                    allow: Boolean(typedResult.allow),
                    reason: String(typedResult.reason || "opa_object_result"),
                };
            }
            return { allow: false, reason: "opa_invalid_result" };
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            if (!failClosed) {
                return { allow: true, reason: `opa_error_fail_open:${detail}` };
            }
            return { allow: false, reason: `opa_error_fail_closed:${detail}` };
        }
        finally {
            clearTimeout(timeout);
        }
    }
};
exports.OpaPolicyService = OpaPolicyService;
exports.OpaPolicyService = OpaPolicyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], OpaPolicyService);
