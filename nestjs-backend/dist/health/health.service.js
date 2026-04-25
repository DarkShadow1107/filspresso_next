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
exports.HealthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const database_service_1 = require("../database/database.service");
let HealthService = class HealthService {
    configService;
    databaseService;
    aiHealthHost;
    adminHealthUrl;
    serviceHealthState = {
        backend: {
            status: "up",
            changedAt: new Date().toISOString(),
            lastCheckedAt: null,
            lastDowntimeAt: null,
            lastRecoveryAt: new Date().toISOString(),
            lastError: null,
        },
        database: {
            status: "up",
            changedAt: new Date().toISOString(),
            lastCheckedAt: null,
            lastDowntimeAt: null,
            lastRecoveryAt: new Date().toISOString(),
            lastError: null,
        },
        ai: {
            status: "up",
            changedAt: new Date().toISOString(),
            lastCheckedAt: null,
            lastDowntimeAt: null,
            lastRecoveryAt: new Date().toISOString(),
            lastError: null,
        },
        administration: {
            status: "up",
            changedAt: new Date().toISOString(),
            lastCheckedAt: null,
            lastDowntimeAt: null,
            lastRecoveryAt: new Date().toISOString(),
            lastError: null,
        },
    };
    constructor(configService, databaseService) {
        this.configService = configService;
        this.databaseService = databaseService;
        this.aiHealthHost = String(this.configService.get("health.aiHealthHost") || "").trim() || "http://localhost:5000";
        this.adminHealthUrl = String(this.configService.get("health.adminHealthUrl") || "").trim();
    }
    getLiveness(requestId) {
        return {
            status: "ok",
            timestamp: new Date().toISOString(),
            requestId,
        };
    }
    applyServiceHealth(serviceName, isUp, errorMessage) {
        const nowIso = new Date().toISOString();
        const serviceState = this.serviceHealthState[serviceName];
        const nextStatus = isUp ? "up" : "down";
        if (serviceState.status !== nextStatus) {
            serviceState.status = nextStatus;
            serviceState.changedAt = nowIso;
            if (nextStatus === "down") {
                serviceState.lastDowntimeAt = nowIso;
            }
            else {
                serviceState.lastRecoveryAt = nowIso;
            }
        }
        serviceState.lastCheckedAt = nowIso;
        serviceState.lastError = errorMessage;
    }
    async checkAiHealth() {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        try {
            const response = await fetch(`${this.aiHealthHost}/api/health`, {
                method: "GET",
                signal: controller.signal,
                headers: { Accept: "application/json" },
            });
            if (!response.ok) {
                return { isUp: false, error: `AI health returned ${response.status}` };
            }
            return { isUp: true, error: null };
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                return { isUp: false, error: "AI health check timed out" };
            }
            const detail = error instanceof Error ? error.message : String(error);
            return { isUp: false, error: detail || "AI health check failed" };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async checkAdministrationHealth(canRunAdmin) {
        if (!canRunAdmin) {
            return { isUp: false, error: "Administration service is unavailable because backend/database is down" };
        }
        if (!this.adminHealthUrl) {
            return { isUp: true, error: null };
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        try {
            const response = await fetch(this.adminHealthUrl, {
                method: "GET",
                signal: controller.signal,
                headers: { Accept: "application/json" },
            });
            if (!response.ok) {
                return { isUp: false, error: `Administration health returned ${response.status}` };
            }
            return { isUp: true, error: null };
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                return { isUp: false, error: "Administration health check timed out" };
            }
            const detail = error instanceof Error ? error.message : String(error);
            return { isUp: false, error: detail || "Administration health check failed" };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async getServicesHealth(requestId) {
        const checkedAt = new Date().toISOString();
        const dbHealth = await this.databaseService.checkHealth();
        const aiHealth = await this.checkAiHealth();
        const backendIsUp = dbHealth.isUp;
        const backendError = backendIsUp ? null : "Backend service is unavailable because database is down";
        const adminHealth = await this.checkAdministrationHealth(backendIsUp);
        this.applyServiceHealth("backend", backendIsUp, backendError);
        this.applyServiceHealth("database", dbHealth.isUp, dbHealth.error);
        this.applyServiceHealth("ai", aiHealth.isUp, aiHealth.error);
        this.applyServiceHealth("administration", adminHealth.isUp, adminHealth.error);
        const services = {
            backend: { ...this.serviceHealthState.backend, displayName: "Server-side API" },
            database: { ...this.serviceHealthState.database, displayName: "PostgreSQL Database" },
            ai: { ...this.serviceHealthState.ai, displayName: "AI Model Services" },
            administration: { ...this.serviceHealthState.administration, displayName: "Administration Console" },
        };
        const upCount = Object.values(services).filter((service) => service.status === "up").length;
        return {
            status: "ok",
            checkedAt,
            strictDbOnlyMetrics: this.configService.get("SERVICE_METRICS_STRICT_DB_ONLY") === "true",
            summary: {
                totalServices: Object.keys(services).length,
                upServices: upCount,
                downServices: Object.keys(services).length - upCount,
            },
            services,
            requestId,
        };
    }
};
exports.HealthService = HealthService;
exports.HealthService = HealthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        database_service_1.DatabaseService])
], HealthService);
