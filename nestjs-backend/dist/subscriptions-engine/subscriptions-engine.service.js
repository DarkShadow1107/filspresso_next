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
var SubscriptionsEngineService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionsEngineService = void 0;
const common_1 = require("@nestjs/common");
const serviceAssertionUtils = __importStar(require("../common/utils/serviceAssertions"));
const serviceContracts = __importStar(require("../common/utils/serviceContracts"));
const egressPolicy = __importStar(require("../common/utils/egressPolicy"));
let SubscriptionsEngineService = SubscriptionsEngineService_1 = class SubscriptionsEngineService {
    logger = new common_1.Logger(SubscriptionsEngineService_1.name);
    kotlinSubsUrl;
    requireServiceAssertion;
    serviceAssertionScope;
    assertionPrivateKey;
    assertionIssuer;
    assertionSubject;
    assertionTtlSeconds;
    constructor() {
        this.kotlinSubsUrl = String(process.env.KOTLIN_SUBSCRIPTIONS_URL || "http://localhost:8084");
        this.requireServiceAssertion = String(process.env.KOTLIN_SUBSCRIPTIONS_REQUIRE_SERVICE_ASSERTION || "true").toLowerCase() === "true";
        this.serviceAssertionScope = String(process.env.KOTLIN_SUBSCRIPTIONS_SERVICE_ASSERTION_SCOPE || "service-subscriptions:quote");
        this.assertionPrivateKey = String(process.env.SERVICE_ASSERTION_PRIVATE_KEY || "");
        this.assertionIssuer = String(process.env.SERVICE_ASSERTION_ISSUER || "filspresso-backend");
        this.assertionSubject = String(process.env.SERVICE_ASSERTION_SUBJECT || "backend");
        this.assertionTtlSeconds = Math.min(Math.max(Number.parseInt(process.env.SERVICE_ASSERTION_TTL_SECONDS || "120", 10) || 120, 30), 600);
        try {
            egressPolicy.assertAllowedEgress(this.kotlinSubsUrl, "KOTLIN_SUBSCRIPTIONS_URL");
        }
        catch (e) {
            this.logger.warn(`Egress policy check failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    buildUpstreamHeaders(base = {}) {
        if (!this.assertionPrivateKey)
            return this.requireServiceAssertion ? null : base;
        try {
            const issued = serviceAssertionUtils.issueServiceAssertion({
                privateKeyPem: this.assertionPrivateKey, issuer: this.assertionIssuer,
                subject: this.assertionSubject, scope: this.serviceAssertionScope,
                ttlSeconds: this.assertionTtlSeconds,
            });
            return { ...base, "x-service-name": "filspresso-backend", "x-service-assertion": issued.token };
        }
        catch (e) {
            this.logger.warn(`Failed to issue subscription service assertion: ${e instanceof Error ? e.message : String(e)}`);
            return this.requireServiceAssertion ? null : base;
        }
    }
    async getHealth() {
        const headers = this.buildUpstreamHeaders({ Accept: "application/json" });
        if (!headers)
            throw new common_1.ServiceUnavailableException({ error: "Subscription service assertion is required but could not be issued" });
        const upstream = await fetch(`${this.kotlinSubsUrl}/api/subscriptions/health`, { headers });
        if (!upstream.ok)
            throw new common_1.ServiceUnavailableException({ error: "Kotlin subscription service unavailable" });
        const data = await upstream.json();
        return { upstream: data };
    }
    async getQuote(user, body) {
        const headers = this.buildUpstreamHeaders({ "Content-Type": "application/json", Accept: "application/json" });
        if (!headers)
            throw new common_1.ServiceUnavailableException({ error: "Subscription service assertion is required but could not be issued" });
        const quoteRequest = {
            tier: body["tier"], billingCycle: body["billingCycle"],
            currentTier: body["currentTier"] || String(user["subscription"] || "free").toLowerCase(),
        };
        serviceContracts.assertServiceContract("kotlin_quote_request_v1", quoteRequest);
        const upstream = await fetch(`${this.kotlinSubsUrl}/api/subscriptions/quote`, {
            method: "POST", headers, body: JSON.stringify(quoteRequest),
        });
        if (!upstream.ok) {
            const detail = await upstream.text().catch(() => "");
            this.logger.error(`Kotlin subscription quote error: ${detail}`);
            throw new common_1.ServiceUnavailableException({ error: "Subscription quote engine failed" });
        }
        const quote = await upstream.json();
        serviceContracts.assertServiceContract("kotlin_quote_response_v1", { quote });
        return { quote };
    }
};
exports.SubscriptionsEngineService = SubscriptionsEngineService;
exports.SubscriptionsEngineService = SubscriptionsEngineService = SubscriptionsEngineService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], SubscriptionsEngineService);
