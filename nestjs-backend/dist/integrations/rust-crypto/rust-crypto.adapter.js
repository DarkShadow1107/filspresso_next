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
exports.RustCryptoAdapter = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let RustCryptoAdapter = class RustCryptoAdapter {
    configService;
    baseUrl;
    timeoutMs;
    constructor(configService) {
        this.configService = configService;
        this.baseUrl = String(this.configService.get("integrations.rustCryptoUrl") || "http://localhost:8090").replace(/\/$/, "");
        this.timeoutMs = Math.min(Math.max(Number.parseInt(process.env.RUST_CRYPTO_TIMEOUT_MS || "4000", 10) || 4000, 1000), 15000);
    }
    async request(path, init) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                ...init,
                signal: controller.signal,
                headers: {
                    Accept: "application/json",
                    ...(init.body ? { "Content-Type": "application/json" } : {}),
                    ...(init.headers || {}),
                },
            });
            if (!response.ok) {
                throw new Error(`rust-crypto request failed with ${response.status}`);
            }
            return (await response.json());
        }
        finally {
            clearTimeout(timeout);
        }
    }
    health() {
        return this.request("/health", { method: "GET" });
    }
    commitment(payload, headers = {}) {
        return this.request("/commitment", {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });
    }
    verify(payload, headers = {}) {
        return this.request("/verify", {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });
    }
};
exports.RustCryptoAdapter = RustCryptoAdapter;
exports.RustCryptoAdapter = RustCryptoAdapter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RustCryptoAdapter);
