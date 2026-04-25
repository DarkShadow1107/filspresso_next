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
exports.KotlinSubscriptionsAdapter = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let KotlinSubscriptionsAdapter = class KotlinSubscriptionsAdapter {
    configService;
    baseUrl;
    constructor(configService) {
        this.configService = configService;
        this.baseUrl = String(this.configService.get("integrations.kotlinSubscriptionsUrl") || "http://localhost:8084").replace(/\/$/, "");
    }
    async health() {
        const response = await fetch(`${this.baseUrl}/api/subscriptions/health`, {
            method: "GET",
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            throw new Error(`kotlin-subscriptions health failed with ${response.status}`);
        }
        return (await response.json());
    }
    async quote(payload, headers = {}) {
        const response = await fetch(`${this.baseUrl}/api/subscriptions/quote`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...headers,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`kotlin-subscriptions quote failed with ${response.status}`);
        }
        return (await response.json());
    }
};
exports.KotlinSubscriptionsAdapter = KotlinSubscriptionsAdapter;
exports.KotlinSubscriptionsAdapter = KotlinSubscriptionsAdapter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], KotlinSubscriptionsAdapter);
