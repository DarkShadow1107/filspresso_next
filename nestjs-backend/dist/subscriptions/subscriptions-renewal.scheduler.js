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
var SubscriptionRenewalScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionRenewalScheduler = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const subscriptions_service_1 = require("../subscriptions/subscriptions.service");
/**
 * Renews subscriptions whose period has ended, and retires the ones that will not renew.
 *
 * Until this existed, a Max subscriber reached their renewal date and nothing happened at
 * all: no payment was recorded, no renewal date moved, and access simply continued
 * indefinitely. The UI offered auto-renew and the product never acted on it.
 *
 * ## Why a timer and not a cron library
 *
 * The backend already runs its other periodic work on `setInterval` (see
 * `security-observability.scheduler.ts`), so this matches the house pattern and adds no
 * dependency. The cost is that the interval is per instance: with three replicas the job
 * runs three times. That is safe here only because the work is idempotent and guarded -- see
 * `RENEWAL_LOCK_NAME`.
 */
let SubscriptionRenewalScheduler = SubscriptionRenewalScheduler_1 = class SubscriptionRenewalScheduler {
    db;
    subscriptions;
    logger = new common_1.Logger(SubscriptionRenewalScheduler_1.name);
    timer;
    constructor(db, subscriptions) {
        this.db = db;
        this.subscriptions = subscriptions;
    }
    async onModuleInit() {
        // On boot, so a backend that was down across a renewal boundary does not leave the
        // lapse to chance. The work is a handful of rows, not a sweep.
        await this.runOnce("boot");
        const intervalMs = readIntervalMs();
        this.timer = setInterval(() => {
            void this.runOnce("interval");
        }, intervalMs);
        this.logger.log(`Subscription renewal scheduler initialized (every ${Math.round(intervalMs / 1000)}s)`);
    }
    onModuleDestroy() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    /**
     * One renewal pass.
     *
     * Held under a Postgres advisory lock so that several backend instances -- which each run
     * their own interval -- cannot renew the same subscription twice. Without it, two
     * instances both see the row, both charge, and the customer is billed twice for one
     * month; the lock is the only thing standing between a timer and a double charge.
     */
    async runOnce(trigger) {
        const client = await this.db.getPool().connect();
        let locked = false;
        try {
            const lock = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [
                RENEWAL_LOCK_NAME,
            ]);
            if (!lock.rows[0]?.locked) {
                // Another instance is doing exactly this work right now. Not an error.
                this.logger.log(`Renewal pass (${trigger}) skipped: another instance holds the lock`);
                return { renewed: 0, retired: 0, skipped: true };
            }
            locked = true;
            const renewed = await this.subscriptions.renewDueSubscriptions();
            const retired = await this.subscriptions.retireLapsedSubscriptions();
            if (renewed > 0 || retired > 0) {
                this.logger.log(`Renewal pass (${trigger}): ${renewed} renewed, ${retired} retired`);
            }
            return { renewed, retired, skipped: false };
        }
        catch (err) {
            // A failed pass must not kill the interval, or one transient error silently stops
            // every future renewal.
            this.logger.error(`Renewal pass (${trigger}) failed: ${err instanceof Error ? err.message : String(err)}`);
            return { renewed: 0, retired: 0, skipped: false };
        }
        finally {
            if (locked) {
                await client.query("SELECT pg_advisory_unlock($1)", [RENEWAL_LOCK_NAME]).catch(() => undefined);
            }
            client.release();
        }
    }
};
exports.SubscriptionRenewalScheduler = SubscriptionRenewalScheduler;
exports.SubscriptionRenewalScheduler = SubscriptionRenewalScheduler = SubscriptionRenewalScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        subscriptions_service_1.SubscriptionsService])
], SubscriptionRenewalScheduler);
/**
 * Arbitrary but fixed key for the advisory lock.
 *
 * Any 64-bit value works; it must simply be the same on every instance, so it cannot be
 * derived from anything per-process.
 */
const RENEWAL_LOCK_NAME = 8_675_309;
/** Default five minutes; short enough that a lapse is not missed for long. */
function readIntervalMs() {
    const raw = Number(process.env.SUBSCRIPTION_RENEWAL_INTERVAL_MS ?? "");
    if (Number.isFinite(raw) && raw >= 10_000)
        return raw;
    return 5 * 60 * 1000;
}
