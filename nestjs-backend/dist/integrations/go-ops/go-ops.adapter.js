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
exports.GoOpsAdapter = void 0;
const httpClient_1 = require("../../common/utils/httpClient");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let GoOpsAdapter = class GoOpsAdapter {
    configService;
    baseUrl;
    constructor(configService) {
        this.configService = configService;
        this.baseUrl = String(this.configService.get("integrations.goOpsUrl") || "http://localhost:8083").replace(/\/$/, "");
    }
    /**
     * Deadline for calls to the go-ops service.
     *
     * Phase 7.6: this adapter had no timeout at all. It is registered as a global
     * provider, so the moment anything injects it, a go-ops that accepted the
     * connection and then stalled would hang the caller forever.
     */
    timeoutMs = (0, httpClient_1.readIntEnv)("GO_OPS_TIMEOUT_MS", 5000, 500, 60000);
    /**
     * Ceiling on a buffered go-ops response, so a runaway peer cannot exhaust the heap.
     */
    maxResponseBytes = (0, httpClient_1.readIntEnv)("GO_OPS_MAX_RESPONSE_BYTES", 2097152, 1024, 64 * 1024 * 1024);
    async health() {
        const response = await (0, httpClient_1.fetchBounded)(`${this.baseUrl}/health`, {
            timeoutMs: this.timeoutMs,
            maxBytes: this.maxResponseBytes,
            method: "GET",
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            throw new Error(`go-ops health failed with ${response.status}`);
        }
        return (await response.json());
    }
    async ingestEvent(payload, headers = {}) {
        const response = await (0, httpClient_1.fetchBounded)(`${this.baseUrl}/events/ingest`, {
            timeoutMs: this.timeoutMs,
            maxBytes: this.maxResponseBytes,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...headers,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`go-ops ingest failed with ${response.status}`);
        }
        return (await response.json());
    }
};
exports.GoOpsAdapter = GoOpsAdapter;
exports.GoOpsAdapter = GoOpsAdapter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GoOpsAdapter);
