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
exports.JavaInvoiceAdapter = void 0;
const httpClient_1 = require("../../common/utils/httpClient");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let JavaInvoiceAdapter = class JavaInvoiceAdapter {
    configService;
    baseUrl;
    constructor(configService) {
        this.configService = configService;
        this.baseUrl = String(this.configService.get("integrations.invoiceServiceUrl") || "http://localhost:8082").replace(/\/$/, "");
    }
    /**
     * Deadline for calls to the invoice service service.
     *
     * Phase 7.6: this adapter had no timeout at all. It is registered as a global
     * provider, so the moment anything injects it, a invoice service that accepted the
     * connection and then stalled would hang the caller forever.
     */
    timeoutMs = (0, httpClient_1.readIntEnv)("INVOICE_TIMEOUT_MS", 10000, 500, 60000);
    /**
     * Ceiling on a buffered invoice service response, so a runaway peer cannot exhaust the heap.
     */
    maxResponseBytes = (0, httpClient_1.readIntEnv)("INVOICE_MAX_RESPONSE_BYTES", 8388608, 1024, 64 * 1024 * 1024);
    async health() {
        const response = await (0, httpClient_1.fetchBounded)(`${this.baseUrl}/api/invoices/health`, {
            timeoutMs: this.timeoutMs,
            maxBytes: this.maxResponseBytes,
            method: "GET",
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            throw new Error(`invoice service health failed with ${response.status}`);
        }
        return (await response.json());
    }
    async renderPdf(payload, headers = {}) {
        const response = await (0, httpClient_1.fetchBounded)(`${this.baseUrl}/api/invoices/render`, {
            timeoutMs: this.timeoutMs,
            maxBytes: this.maxResponseBytes,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/pdf",
                ...headers,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`invoice render failed with ${response.status}`);
        }
        return response.arrayBuffer();
    }
};
exports.JavaInvoiceAdapter = JavaInvoiceAdapter;
exports.JavaInvoiceAdapter = JavaInvoiceAdapter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], JavaInvoiceAdapter);
