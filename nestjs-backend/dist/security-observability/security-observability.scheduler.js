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
var SecurityObservabilityScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityObservabilityScheduler = void 0;
const common_1 = require("@nestjs/common");
const security_observability_service_1 = require("./security-observability.service");
const replayGuard_1 = require("../common/utils/replayGuard");
const database_service_1 = require("../database/database.service");
let SecurityObservabilityScheduler = SecurityObservabilityScheduler_1 = class SecurityObservabilityScheduler {
    securityObservabilityService;
    db;
    logger = new common_1.Logger(SecurityObservabilityScheduler_1.name);
    retentionJobTimer;
    ledgerArchiveJobTimer;
    constructor(securityObservabilityService, db) {
        this.securityObservabilityService = securityObservabilityService;
        this.db = db;
    }
    async onModuleInit() {
        await this.securityObservabilityService.pruneOldServiceIncidents();
        this.retentionJobTimer = setInterval(() => {
            void this.securityObservabilityService.pruneOldServiceIncidents();
        }, this.securityObservabilityService.getRetentionJobIntervalMs());
        if (this.securityObservabilityService.isArchiveSchedulerEnabled()) {
            await this.securityObservabilityService.runSecurityLedgerArchiveJob();
            this.ledgerArchiveJobTimer = setInterval(() => {
                void this.securityObservabilityService.runSecurityLedgerArchiveJob();
            }, this.securityObservabilityService.getArchiveSchedulerIntervalMs());
        }
        // Phase 7.5: the replay-guard expiry sweep lives here, beside the other timers.
        // It used to run as a DELETE on every guarded request.
        (0, replayGuard_1.startReplaySweep)(this.db.getPool());
        this.logger.log("Security observability schedulers initialized");
    }
    onModuleDestroy() {
        if (this.retentionJobTimer) {
            clearInterval(this.retentionJobTimer);
            this.retentionJobTimer = undefined;
        }
        if (this.ledgerArchiveJobTimer) {
            clearInterval(this.ledgerArchiveJobTimer);
            this.ledgerArchiveJobTimer = undefined;
        }
        (0, replayGuard_1.stopReplaySweep)();
    }
};
exports.SecurityObservabilityScheduler = SecurityObservabilityScheduler;
exports.SecurityObservabilityScheduler = SecurityObservabilityScheduler = SecurityObservabilityScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [security_observability_service_1.SecurityObservabilityService,
        database_service_1.DatabaseService])
], SecurityObservabilityScheduler);
