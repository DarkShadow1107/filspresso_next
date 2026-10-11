"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KafelotController = void 0;
const common_1 = require("@nestjs/common");
const kafelot_service_1 = require("./kafelot.service");
const model_usage_service_1 = require("./model-usage.service");
const billing_service_1 = require("../billing/billing.service");
const fingerprint_1 = require("../common/utils/fingerprint");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const optional_jwt_auth_guard_1 = require("../common/guards/optional-jwt-auth.guard");
const net = __importStar(require("net"));
function normalizeClientIp(value) {
    if (!value)
        return null;
    let candidate = Array.isArray(value) ? String(value[0] || "") : String(value).split(",")[0].trim();
    candidate = candidate.replace(/^"|"$/g, "").trim();
    if (!candidate)
        return null;
    if (candidate.startsWith("[") && candidate.includes("]"))
        candidate = candidate.slice(1, candidate.indexOf("]")).trim();
    const mappedIpv4Match = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mappedIpv4Match && net.isIP(mappedIpv4Match[1]) === 4)
        return mappedIpv4Match[1];
    if (net.isIP(candidate))
        return candidate;
    const ipv4WithPortMatch = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPortMatch && net.isIP(ipv4WithPortMatch[1]) === 4)
        return ipv4WithPortMatch[1];
    return null;
}
function getClientIp(req) {
    // Phase 10 review. This preferred four client-supplied headers over the socket, so
    // usage attribution -- and any scope or quota keyed off it -- was assignable by the
    // caller. Express resolves `req.ip` against the configured `trust proxy`, which is
    // the decision worth honouring; the header forms stay only as a fallback for a
    // deployment that terminates TLS somewhere this process cannot see.
    return normalizeClientIp(req.ip) ||
        normalizeClientIp(req.socket?.remoteAddress) ||
        normalizeClientIp(req.headers["cf-connecting-ip"]) ||
        normalizeClientIp(req.headers["x-real-ip"]) ||
        normalizeClientIp(req.headers["x-forwarded-for"]) || null;
}
function resolveUsageScope(req) {
    const bodyScope = req.body && typeof req.body === "object" ? req.body.scope : undefined;
    const headerScope = req.headers["x-kafelot-scope"];
    const queryScope = req.query?.scope;
    return (0, kafelot_service_1.normalizeUsageScope)((bodyScope || headerScope || queryScope || kafelot_service_1.USAGE_SCOPES.GENERAL));
}
/**
 * Molecule Helper (chemistry) is ULTIMATE-only.
 *
 * The Next.js route gates it too, but there is no Next `middleware.ts`, so this
 * controller is the authoritative choke point for the quota: a direct call to
 * `/api/kafelot/check-and-use` with `scope=molecule_helper` would otherwise reach
 * `checkAndUse` unthrottled by any tier check. That matters because the molecule
 * bucket is 200 prompts on every tier.
 */
const MOLECULE_HELPER_TIER = "ultimate";
/**
 * Normalise the client-supplied model key.
 *
 * Only keys we actually meter are accepted. An unrecognised key must NOT fall
 * through to "meter nothing" -- that would let a caller bypass per-model limits by
 * sending a typo, so it is dropped and the request is metered on the scope total
 * alone, which is the correct, if less specific, fallback.
 */
/**
 * The anonymous fingerprint, validated by the same rule as the billing endpoint.
 *
 * These two read the same header and key the same budget, so they must agree about what a
 * fingerprint is. They previously did not: the pre-flight path truncated an over-long value
 * to fit VARCHAR(64) while the metering endpoint accepted whatever it was given, which meant
 * a caller could hold two different budgets at once.
 *
 * Absent is null -- an anonymous caller may legitimately send none, and the per-IP rate
 * limiter is the guard there. Present but malformed throws a 400 rather than being repaired.
 */
function readFingerprint(req) {
    const raw = req.headers[fingerprint_1.FINGERPRINT_HEADER];
    if (raw === undefined || raw === null || raw === "")
        return null;
    return (0, fingerprint_1.parseFingerprint)(raw);
}
function normalizeModelKey(raw) {
    if (typeof raw !== "string")
        return null;
    const key = raw.trim();
    if (!key || key.length > 64)
        return null;
    return (0, model_usage_service_1.isMeteredModel)(key) ? key : null;
}
let KafelotController = class KafelotController {
    kafelotService;
    modelUsage;
    billing;
    constructor(kafelotService, modelUsage, billing) {
        this.kafelotService = kafelotService;
        this.modelUsage = modelUsage;
        this.billing = billing;
    }
    /**
     * May this caller afford one more generation?
     *
     * Signed-in callers are judged on allowance-or-wallet by the billing service, which owns
     * both numbers. Anonymous callers have no wallet, so their fingerprint-keyed allowance is
     * the whole answer.
     *
     * Fails closed, and that is a deliberate choice: a billing lookup that errors must not
     * read as "free", which is exactly what a no-op gate does. An account in this state gets
     * a 402 they can act on rather than a generation they cannot afford.
     */
    async resolveMoneyState(req, fingerprint) {
        const accountId = req.user?.id ? Number(req.user.id) : 0;
        try {
            if (Number.isInteger(accountId) && accountId > 0) {
                const tier = await this.kafelotService.resolveTier(accountId);
                const state = await this.billing.canGenerate(accountId, tier);
                return {
                    canGenerate: state.canGenerate,
                    message: "Your monthly AI allowance and playground balance are both spent.",
                    allowanceRemainingRon: state.allowanceRemainingRon,
                    balanceRon: state.balanceRon,
                };
            }
            if (fingerprint) {
                const allowance = await this.billing.getAnonymousAllowance(fingerprint);
                return {
                    canGenerate: allowance.remainingRon > 0,
                    message: "Your free AI allowance for this month is used up.",
                    allowanceRemainingRon: allowance.remainingRon,
                    balanceRon: null,
                };
            }
            // No account and no fingerprint: nothing to meter against. The per-IP rate limiter is
            // the guard for this caller, so the money gate has nothing to say and does not refuse
            // a path that is deliberately open.
            return {
                canGenerate: true,
                message: "",
                allowanceRemainingRon: null,
                balanceRon: null,
            };
        }
        catch (err) {
            return {
                canGenerate: false,
                message: `We could not check your AI balance right now (${err instanceof Error ? err.message : "unknown"}).`,
                allowanceRemainingRon: null,
                balanceRon: null,
            };
        }
    }
    async checkAndUse(req, res) {
        const fingerprint = readFingerprint(req);
        const hasBearerToken = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
        const ip = getClientIp(req);
        const userAgent = req.headers["user-agent"] || "";
        const systemInfo = req.body?.system_info || {};
        const dryRun = req.body?.dry_run === true;
        const usageScope = resolveUsageScope(req);
        if (hasBearerToken && !req.user) {
            return res.status(common_1.HttpStatus.UNAUTHORIZED).json({ error: "AUTH_SESSION_INVALID", message: "Authentication session expired or invalid" });
        }
        // Defence in depth for the chemistry gate. `req.user.tier` is not populated by
        // the session claims, so ask the service for the caller's authoritative tier
        // rather than trusting anything on the request.
        if (usageScope === kafelot_service_1.USAGE_SCOPES.MOLECULE_HELPER) {
            const tier = req.user?.id
                ? await this.kafelotService.resolveTier(Number(req.user.id))
                : "anonymous";
            if (String(tier || "").toLowerCase() !== MOLECULE_HELPER_TIER) {
                return res.status(common_1.HttpStatus.FORBIDDEN).json({
                    error: "CHEMISTRY_LOCKED",
                    message: "Molecule Helper is available on the ULTIMATE plan.",
                });
            }
        }
        // The money gate, at the authoritative choke point.
        //
        // The RON allowance was only enforced after the fact, when the usage report arrived. That
        // is not enforcement: it means every generation runs at full cost and the balance is told
        // afterwards. A customer with nothing left was served first and billed second, which is
        // the same shape as no gate at all, only with a ledger attached.
        //
        // Checked here because this controller already is the one place a direct API call cannot
        // get past -- the Next route also gates, but there is no Next middleware, so this is the
        // boundary that holds when someone calls the backend directly.
        //
        // Both pots, for the same reason the Playground does: included allowance and card wallet
        // are interchangeable while either has money in it.
        const money = await this.resolveMoneyState(req, fingerprint);
        if (!money.canGenerate) {
            return res.status(common_1.HttpStatus.PAYMENT_REQUIRED).json({
                error: "INSUFFICIENT_BALANCE",
                message: money.message,
                allowance_remaining_ron: money.allowanceRemainingRon,
                balance_ron: money.balanceRon,
                // Distinguishable from a chemistry refusal, which is a 403.
                billing: "exhausted",
            });
        }
        const result = await this.kafelotService.checkAndUse({
            accountId: req.user?.id, fingerprint, ip, userAgent, systemInfo, dryRun, usageScope, hasBearerToken,
            // Optional: absent means "meter the scope total only".
            modelKey: normalizeModelKey(req.body?.model_key),
        });
        return res.status(result.status).json(result.data);
    }
    async getStatus(req, res) {
        const fingerprint = readFingerprint(req);
        const hasBearerToken = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
        const ip = getClientIp(req);
        const userAgent = req.headers["user-agent"] || "";
        const usageScope = resolveUsageScope(req);
        if (hasBearerToken && !req.user) {
            return res.status(common_1.HttpStatus.UNAUTHORIZED).json({ error: "AUTH_SESSION_INVALID", message: "Authentication session expired or invalid" });
        }
        const result = await this.kafelotService.getStatus({
            accountId: req.user?.id, fingerprint, ip, userAgent, usageScope, hasBearerToken
        });
        if (result.status === 200 && req.user?.id) {
            // Per-model allowances travel with the status response so the client can grey
            // out a spent model and show what is left, instead of discovering it via a 429.
            // Best-effort: a failure here must not break the status endpoint itself.
            try {
                const tier = await this.kafelotService.resolveTier(Number(req.user.id));
                result.data.model_allowances = await this.modelUsage.allowancesForTier(Number(req.user.id), tier, usageScope);
            }
            catch {
                // leave model_allowances absent; the client treats that as "unknown"
            }
        }
        return res.status(result.status).json(result.data);
    }
    getAnonymousUsers(req, limit, offset, search, res) {
        if (req.user?.role !== "admin")
            return res.status(common_1.HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
        return this.kafelotService.getAnonymousUsers(Number.parseInt(limit || "50", 10), Number.parseInt(offset || "0", 10), search || "").then(r => res.json(r));
    }
    updateAnonymousUser(req, id, res) {
        if (req.user?.role !== "admin")
            return res.status(common_1.HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
        return this.kafelotService.updateAnonymousUser(id, req.body.prompts_limit, req.body.prompts_used).then(r => res.json(r)).catch(e => {
            if (e.status === 404)
                return res.status(404).json({ error: "Not found" });
            return res.status(500).json({ error: "Internal server error" });
        });
    }
    getUsersUsage(req, limit, offset, monthYear, scope, res) {
        if (req.user?.role !== "admin")
            return res.status(common_1.HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
        return this.kafelotService.getUsersUsage(Number.parseInt(limit || "50", 10), Number.parseInt(offset || "0", 10), monthYear, scope).then(r => res.json(r));
    }
    updateUserUsage(req, id, res) {
        if (req.user?.role !== "admin")
            return res.status(common_1.HttpStatus.FORBIDDEN).json({ error: "Admin access required" });
        return this.kafelotService.updateUserUsage(id, req.body.prompts_limit, req.body.prompts_used).then(r => res.json(r)).catch(e => {
            if (e.status === 404)
                return res.status(404).json({ error: "Not found" });
            return res.status(500).json({ error: "Internal server error" });
        });
    }
};
exports.KafelotController = KafelotController;
__decorate([
    (0, common_1.UseGuards)(optional_jwt_auth_guard_1.OptionalJwtAuthGuard),
    (0, common_1.Post)("check-and-use"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], KafelotController.prototype, "checkAndUse", null);
__decorate([
    (0, common_1.UseGuards)(optional_jwt_auth_guard_1.OptionalJwtAuthGuard),
    (0, common_1.Get)("status"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], KafelotController.prototype, "getStatus", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("anonymous"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("limit")),
    __param(2, (0, common_1.Query)("offset")),
    __param(3, (0, common_1.Query)("search")),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], KafelotController.prototype, "getAnonymousUsers", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Put)("anonymous/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", void 0)
], KafelotController.prototype, "updateAnonymousUser", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)("users"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("limit")),
    __param(2, (0, common_1.Query)("offset")),
    __param(3, (0, common_1.Query)("month_year")),
    __param(4, (0, common_1.Query)("scope")),
    __param(5, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], KafelotController.prototype, "getUsersUsage", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Put)("users/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", void 0)
], KafelotController.prototype, "updateUserUsage", null);
exports.KafelotController = KafelotController = __decorate([
    (0, common_1.Controller)("api/kafelot"),
    __metadata("design:paramtypes", [kafelot_service_1.KafelotService,
        model_usage_service_1.ModelUsageService,
        billing_service_1.BillingService])
], KafelotController);
