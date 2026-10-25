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
exports.DesktopController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const billing_service_1 = require("../billing/billing.service");
const addons_service_1 = require("../billing/addons.service");
const addons_service_2 = require("../billing/addons.service");
const model_pricing_1 = require("../billing/model-pricing");
const tier_allowance_1 = require("../billing/tier-allowance");
const text_models_1 = require("./text-models");
const desktop_gateway_service_1 = require("./desktop-gateway.service");
const desktop_installer_service_1 = require("./desktop-installer.service");
const desktop_policy_1 = require("./desktop-policy");
/**
 * One call that answers "may I use this, and can I afford it".
 *
 * Why a single endpoint rather than letting the app compose the existing ones. It needs
 * Spectre access, the allowance, the wallet and `canGenerate` before it can render its
 * state, and it needs them again after every completed generation. Calling
 * `/api/spectre/access`, `/api/billing/allowance`, `/api/billing/balance` and
 * `/api/billing/can-generate` separately is four round trips per refresh, each one
 * separately rate limited against a global ceiling of 1200 requests per 15 minutes
 * (constants.ts). On a metered product that is the wrong shape: it spends the user's quota
 * to draw the screen, and it can draw an inconsistent screen if two of the four answers
 * were taken moments apart.
 *
 * Everything below is read from the same services the money gate reads, so what the app is
 * told and what it is charged cannot drift into disagreeing.
 */
let DesktopController = class DesktopController {
    billing;
    addons;
    gateway;
    installer;
    constructor(billing, addons, gateway, installer) {
        this.billing = billing;
        this.addons = addons;
        this.gateway = gateway;
        this.installer = installer;
    }
    /**
     * Where the desktop app is, and whether this account may have it.
     *
     * The account page asks for this so it can show the download without the page
     * having to know where installers live. The answer is deliberately available to
     * an account *without* Spectre access: the app is a Spectre feature, but hiding
     * the fact that it exists from someone who has not subscribed yet is how a
     * product nobody can find stays that way. What the answer withholds is the
     * file itself.
     */
    async installerInfo(req) {
        const accountId = Number(req.user?.id);
        if (!Number.isInteger(accountId) || accountId <= 0) {
            throw new common_1.UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
        }
        const tier = await this.billing.resolveTierFor(accountId);
        const access = await this.addons.resolveSpectreAccess(accountId, tier, (0, tier_allowance_1.canUseSpectre)(tier));
        const available = await this.installer.isAvailable();
        return {
            available,
            fileName: this.installer.fileName,
            // The button is disabled rather than failing on click, so the reason is on
            // screen before the customer tries.
            canDownload: available && access.hasAccess,
            downloadUrl: "/api/desktop/download",
        };
    }
    /**
     * The installer itself.
     *
     * Gated on Spectre access, because the app is a Spectre feature and the access
     * check is the same one the client's own entitlement call uses -- a download that
     * does not check would let anyone who guessed the URL have the app.
     */
    async download(req, res) {
        const accountId = Number(req.user?.id);
        if (!Number.isInteger(accountId) || accountId <= 0) {
            throw new common_1.UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
        }
        const tier = await this.billing.resolveTierFor(accountId);
        const access = await this.addons.resolveSpectreAccess(accountId, tier, (0, tier_allowance_1.canUseSpectre)(tier));
        if (!access.hasAccess) {
            throw new common_1.ForbiddenException({
                error: "SPECTRE_REQUIRED",
                message: "The desktop app comes with the Spectre Playground subscription.",
            });
        }
        await this.installer.stream(res);
    }
    /**
     * Stream a generation, metered.
     *
     * The single route the desktop client needs for inference, and the reason Phase 0 could
     * not be skipped: before it, the only way to reach a model from outside a browser was the
     * AI service on port 5000, which authenticates nobody and meters nothing.
     *
     * Every refusal is answered before the response is committed to a stream. Once headers
     * are on the wire the status code is fixed, so the gate cannot be expressed as "start
     * streaming and then report the error" -- a client would have to invent a second error
     * channel inside a success response.
     */
    async chatStream(req, res, body) {
        const accountId = Number(req.user?.id);
        if (!Number.isInteger(accountId) || accountId <= 0) {
            throw new common_1.UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
        }
        const tier = await this.billing.resolveTierFor(accountId);
        const result = await this.gateway.streamChat(res, accountId, tier, body ?? {});
        if (result.kind === "refused") {
            // Not yet committed: the gate runs before any header is written, so this is a
            // normal JSON error response and the client can branch on the status.
            res.status(result.status).json({ error: result.error, message: result.message });
            return;
        }
        // `sent` means the socket is already owned by the gateway, which has ended the
        // response. Writing anything here would corrupt the stream.
    }
    /**
     * The app's single source of truth for entitlement and affordability.
     *
     * `canGenerate` is included rather than left to the app to derive from the allowance and
     * the balance, because the derivation has a subtlety: `canGenerate` is true when *either*
     * pot can pay. An account with no allowance left and a funded wallet may generate, and an
     * app that checked `remainingRon > 0` alone would lock paying customers out of a
     * Playground they can use.
     */
    async entitlement(req) {
        const accountId = Number(req.user?.id);
        if (!Number.isInteger(accountId) || accountId <= 0) {
            throw new common_1.UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
        }
        // Fail closed. If the account state cannot be read, the client is told the service is
        // unavailable -- not that the account is locked and not that it is broke. Those are
        // different messages pointing at different remedies, and answering "locked" to a
        // billing outage would send a paying customer to subscribe again.
        try {
            return await this.entitlementFor(accountId);
        }
        catch {
            throw new common_1.ServiceUnavailableException({ error: "BILLING_UNAVAILABLE" });
        }
    }
    async entitlementFor(accountId) {
        const tier = await this.billing.resolveTierFor(accountId);
        // The allowance is a separate view from the wallet, so it is a separate query. They
        // run concurrently, and they are the same two reads the money gate already performs,
        // so this is not extra load -- it is the same load, answered once instead of twice.
        const [access, balance, allowance] = await Promise.all([
            this.addons.resolveSpectreAccess(accountId, tier, (0, tier_allowance_1.canUseSpectre)(tier)),
            this.billing.getBalance(accountId),
            this.billing.getAllowance(accountId, tier),
        ]);
        const models = this.modelCatalogue(access.source, tier, balance.canGenerate, allowance.remainingRon);
        return {
            accountId,
            tier,
            access: {
                hasAccess: access.hasAccess,
                source: access.source,
                expiresAt: access.expiresAt,
                autoRenew: access.autoRenew,
                canFundWallet: access.canFundWallet,
            },
            // `tierGrantsAccess` is reported separately from `access.source` on purpose. They
            // usually agree, but they answer different questions: one is "does my plan
            // include this", the other is "who is paying for my usage". The app needs both --
            // the first to decide whether to offer the subscription at all, the second to
            // explain where a message is being charged from.
            tierGrantsAccess: (0, tier_allowance_1.canUseSpectre)(tier),
            allowance,
            wallet: {
                balanceRon: balance.balanceRon,
                canGenerate: balance.canGenerate,
                minBalanceRon: balance.minBalanceRon,
                minBalanceIsCustom: balance.minBalanceIsCustom,
                autoRefill: balance.autoRefill,
            },
            canGenerate: models.some((model) => model.canGenerate),
            // The subscription terms, so the app can render an upsell without a second call.
            // Prices are what the account would actually pay, from the same source the charge
            // path uses, so the upsell cannot quote a number the checkout would then change.
            subscription: {
                monthlyRon: addons_service_2.SPECTRE_ADDON_SUMMARY.monthlyRon,
                annualRon: addons_service_2.SPECTRE_ADDON_SUMMARY.annualRon,
                includesUsage: addons_service_2.SPECTRE_ADDON_SUMMARY.includesUsage,
            },
            models,
            attachmentModels: ["lfm2_5_vl_450m_q4_k_m", "lfm2_5_audio_1_5b_q4_0"].map((modelKey) => {
                const price = (0, model_pricing_1.resolveTokenPrice)(modelKey, "playground");
                return { modelKey, label: price.label, ...(0, model_pricing_1.effectiveRates)(price) };
            }),
            // The app polls this after every generation. Stamped so it can tell a fresh answer
            // from a cached one without trusting its own clock against the server's.
            servedAt: new Date().toISOString(),
        };
    }
    /**
     * Every selectable model, including Vision and Audio recommendations for imported media,
     * with the price this account would pay and whether it may run it.
     *
     * Locked models are listed rather than omitted, with their price attached. The app needs
     * to show what exists and what it would cost, and a hidden model cannot do either.
     */
    modelCatalogue(accessSource, tier, walletCanGenerate, allowanceRemainingRon) {
        return (0, text_models_1.playgroundModelKeys)()
            .filter((modelKey) => modelKey in model_pricing_1.MODEL_TOKEN_PRICING)
            .map((modelKey) => {
            const price = (0, model_pricing_1.resolveTokenPrice)(modelKey, "playground");
            const rates = (0, model_pricing_1.effectiveRates)(price);
            // A model the account cannot afford is still listed: the app shows the price and
            // the lock, which is the same thing the web line-up does. `canGenerate` is a
            // hint for the UI, never a gate -- the gateway re-checks on every request,
            // because a balance read at render time says nothing about the balance at
            // send time.
            return {
                modelKey,
                // The display name. Without it the client shows the raw key -- lfm2_5_230m_q4_k_m --
                // which is a storage identifier, not a product name. It comes from the same
                // resolved price the numbers do, so the label and the price cannot disagree
                // about which model this is.
                label: price.label,
                inputPer1M: rates.inputPer1M,
                outputPer1M: rates.outputPer1M,
                priceMode: price.priceMode,
                ...(0, desktop_policy_1.desktopModelAccess)({
                    modelKey,
                    tier,
                    accessSource,
                    walletCanGenerate,
                    allowanceRemainingRon,
                }),
            };
        });
    }
};
exports.DesktopController = DesktopController;
__decorate([
    (0, common_1.Get)("installer"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DesktopController.prototype, "installerInfo", null);
__decorate([
    (0, common_1.Get)("download"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DesktopController.prototype, "download", null);
__decorate([
    (0, common_1.Post)("chat/stream"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], DesktopController.prototype, "chatStream", null);
__decorate([
    (0, common_1.Get)("entitlement"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DesktopController.prototype, "entitlement", null);
exports.DesktopController = DesktopController = __decorate([
    (0, common_1.Controller)("api/desktop"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [billing_service_1.BillingService,
        addons_service_1.AddonsService,
        desktop_gateway_service_1.DesktopGatewayService,
        desktop_installer_service_1.DesktopInstallerService])
], DesktopController);
