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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaygroundContextService = void 0;
exports.modelsForAttachment = modelsForAttachment;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("node:crypto"));
const node_path_1 = __importDefault(require("node:path"));
const billing_service_1 = require("../billing/billing.service");
const addons_service_1 = require("../billing/addons.service");
const tier_allowance_1 = require("../billing/tier-allowance");
const desktop_policy_1 = require("./desktop-policy");
const VISION = "lfm2_5_vl_450m_q4_k_m";
const AUDIO_KEY = "lfm2_5_audio_1_5b_q4_0";
function modelsForAttachment(name) {
    const suffix = node_path_1.default.extname(name).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".pdf"].includes(suffix))
        return [VISION];
    if ([".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus"].includes(suffix))
        return [AUDIO_KEY];
    if ([".mp4", ".webm", ".mov", ".mkv", ".avi"].includes(suffix))
        return [VISION, AUDIO_KEY];
    return [];
}
let PlaygroundContextService = class PlaygroundContextService {
    billing;
    addons;
    constructor(billing, addons) {
        this.billing = billing;
        this.addons = addons;
    }
    async prepareFile(accountId, filename, data, signal) {
        if (!data.length || data.length > 20 * 1024 * 1024)
            throw new common_1.BadRequestException("Choose a file no larger than 20 MB.");
        const decoded = Buffer.from(filename, "latin1").toString("utf8");
        const original = /^[\u0000-\u00ff]*$/.test(filename) && !decoded.includes("\uFFFD") ? decoded : filename;
        const name = original.replaceAll("\\", "/").split("/").pop()?.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180) || "attachment";
        const models = modelsForAttachment(name);
        const account = await this.authorize(accountId, models);
        const result = await this.process("file", data, { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(name) }, signal, (result) => this.settle(result, accountId, account.tier, account.source, models));
        return { ...result, usage: undefined };
    }
    async prepareGithub(accountId, url, signal) {
        if (!/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}\/?$/i.test(url.trim()))
            throw new common_1.BadRequestException("Enter a GitHub URL such as https://github.com/owner/project.");
        await this.authorize(accountId, []);
        const result = await this.process("github", JSON.stringify({ url: url.trim() }), { "Content-Type": "application/json" }, signal);
        return { ...result, usage: undefined };
    }
    async authorize(accountId, models) {
        try {
            const tier = await this.billing.resolveTierFor(accountId);
            const access = await this.addons.resolveSpectreAccess(accountId, tier, (0, tier_allowance_1.canUseSpectre)(tier));
            if (!access.hasAccess)
                throw new common_1.ForbiddenException({ error: "PLAYGROUND_LOCKED", message: "Sign in with Playground access to attach sources." });
            if (models.length) {
                const [wallet, allowance] = await Promise.all([this.billing.getBalance(accountId), this.billing.getAllowance(accountId, tier)]);
                for (const modelKey of models) {
                    if (!(0, desktop_policy_1.desktopModelAccess)({ modelKey, tier, accessSource: access.source, walletCanGenerate: wallet.canGenerate, allowanceRemainingRon: allowance.remainingRon }).canGenerate)
                        throw new common_1.HttpException({ error: "INSUFFICIENT_BALANCE", message: "Your allowance and wallet cannot cover media analysis." }, 402);
                }
            }
            return { tier, source: access.source };
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.ServiceUnavailableException({ error: "BILLING_UNAVAILABLE", message: "Your access and balance could not be checked." });
        }
    }
    async process(kind, body, headers, signal, settle) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (signal?.aborted)
            controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, 16 * 60 * 1000);
        try {
            const host = (process.env.PYTHON_AI_HOST || "http://ai:5000").replace(/\/+$/, "");
            const response = await fetch(`${host}/api/playground/context/${kind}`, {
                method: "POST", headers: { ...headers, ...(process.env.AI_SERVICE_KEY ? { "x-ai-service-key": process.env.AI_SERVICE_KEY } : {}) },
                body: typeof body === "string" ? body : new Uint8Array(body), signal: controller.signal,
            });
            const result = await response.json();
            // A later video frame can fail after earlier analysis has already used tokens.
            // Settle trusted AI-service usage before returning either success or refusal.
            if (settle)
                await settle(result);
            if (!response.ok)
                throw new common_1.HttpException({ error: "ATTACHMENT_ERROR", message: result.message || "This source could not be read." }, response.status);
            if (!result.text || result.text.length > 241_000 || !Array.isArray(result.warnings))
                throw new Error("Invalid context response");
            return result;
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.ServiceUnavailableException({ error: "CONTEXT_UNAVAILABLE", message: "Source processing is unavailable or was cancelled. Please retry." });
        }
        finally {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
        }
    }
    async settle(result, accountId, tier, source, allowed) {
        if (result.usage !== undefined && (!Array.isArray(result.usage) || result.usage.length > 10))
            throw new common_1.ServiceUnavailableException("The attachment model returned invalid usage.");
        for (const [index, usage] of (result.usage || []).entries()) {
            if (!allowed.includes(usage.modelKey) || ![usage.inputTokens, usage.outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0))
                throw new common_1.ServiceUnavailableException("The attachment model returned invalid usage.");
            await this.billing.recordUsage({ accountId, tier, accessSource: source, modelKey: usage.modelKey,
                usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, scope: "playground", requestId: `attachment-${crypto.randomUUID()}-${index}` });
        }
    }
};
exports.PlaygroundContextService = PlaygroundContextService;
exports.PlaygroundContextService = PlaygroundContextService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [billing_service_1.BillingService, addons_service_1.AddonsService])
], PlaygroundContextService);
