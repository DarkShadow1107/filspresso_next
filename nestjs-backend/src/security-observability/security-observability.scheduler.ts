import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SecurityObservabilityService } from "./security-observability.service";

@Injectable()
export class SecurityObservabilityScheduler implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(SecurityObservabilityScheduler.name);
	private retentionJobTimer?: NodeJS.Timeout;
	private ledgerArchiveJobTimer?: NodeJS.Timeout;

	constructor(private readonly securityObservabilityService: SecurityObservabilityService) {}

	async onModuleInit(): Promise<void> {
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

		this.logger.log("Security observability schedulers initialized");
	}

	onModuleDestroy(): void {
		if (this.retentionJobTimer) {
			clearInterval(this.retentionJobTimer);
			this.retentionJobTimer = undefined;
		}

		if (this.ledgerArchiveJobTimer) {
			clearInterval(this.ledgerArchiveJobTimer);
			this.ledgerArchiveJobTimer = undefined;
		}
	}
}
