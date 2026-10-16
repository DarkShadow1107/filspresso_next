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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddonsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const addons_service_1 = require("./addons.service");
const billing_service_1 = require("./billing.service");
const tier_allowance_1 = require("./tier-allowance");
function accountIdOf(req) {
    const id = Number(req.user?.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new common_1.BadRequestException({ error: "ACCOUNT_REQUIRED" });
    }
    return id;
}
/**
 * The Spectre Playground add-on.
 *
 * Public on purpose for the summary: the plans page has to quote the price to someone who
 * has not signed up, exactly as the tier table is public.
 */
let AddonsController = class AddonsController {
    addons;
    billing;
    constructor(addons, billing) {
        this.addons = addons;
        this.billing = billing;
    }
    /** What the product is and what it costs. No authentication. */
    getSubscription() {
        return addons_service_1.SPECTRE_ADDON_SUMMARY;
    }
    /**
     * Whether this account may use the Playground, and why.
     *
     * A single endpoint because the frontend used to re-derive this from the tier in four
     * separate places, which is four chances to disagree with the gate. Now the gate and the
     * UI read the same answer.
     */
    async access(req) {
        const accountId = accountIdOf(req);
        const tier = await this.billing.resolveTierFor(accountId);
        return this.addons.resolveSpectreAccess(accountId, tier, (0, tier_allowance_1.canUseSpectre)(tier));
    }
    async subscribe(req, body) {
        const accountId = accountIdOf(req);
        const cycle = String(body?.billingCycle || "monthly");
        const cardId = await this.billing.defaultCardId(accountId);
        const tier = await this.billing.resolveTierFor(accountId);
        return this.addons.purchase(accountId, cycle === "annual" ? "annual" : "monthly", cardId, tier);
    }
    /** Cancels, keeping access until the period already paid for ends. */
    async cancel(req) {
        return this.addons.cancel(accountIdOf(req));
    }
    async list(req) {
        return { addons: await this.addons.listForAccount(accountIdOf(req)) };
    }
};
exports.AddonsController = AddonsController;
__decorate([
    (0, common_1.Get)("subscription"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AddonsController.prototype, "getSubscription", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("access"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AddonsController.prototype, "access", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("subscribe"),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AddonsController.prototype, "subscribe", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Put)("cancel"),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AddonsController.prototype, "cancel", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("subscriptions"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AddonsController.prototype, "list", null);
exports.AddonsController = AddonsController = __decorate([
    (0, common_1.Controller)("api/spectre"),
    __metadata("design:paramtypes", [addons_service_1.AddonsService,
        billing_service_1.BillingService])
], AddonsController);
