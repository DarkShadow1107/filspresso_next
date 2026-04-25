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
var OperationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationsService = void 0;
const common_1 = require("@nestjs/common");
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const config_1 = require("@nestjs/config");
const serviceAssertionUtils = __importStar(require("../common/utils/serviceAssertions"));
const serviceContracts = __importStar(require("../common/utils/serviceContracts"));
const secrets = __importStar(require("../common/utils/secrets"));
const egressPolicy = __importStar(require("../common/utils/egressPolicy"));
let OperationsService = OperationsService_1 = class OperationsService {
    logger = new common_1.Logger(OperationsService_1.name);
    goOpsUrl;
    goOpsApiKey;
    goOpsTimeoutMs;
    requireTls;
    requireServiceAssertion;
    serviceAssertionScope;
    tlsServerName;
    clientCert;
    clientKey;
    caCert;
    assertionPrivateKey;
    assertionIssuer;
    assertionSubject;
    assertionTtlSeconds;
    httpsAgent;
    constructor(_config) {
        this.goOpsUrl = String(_config.get("integrations.goOpsUrl") || "http://localhost:8083");
        this.goOpsApiKey = String(process.env.GO_OPS_API_KEY || "");
        this.goOpsTimeoutMs = Math.min(Math.max(Number.parseInt(process.env.GO_OPS_TIMEOUT_MS || "5000", 10) || 5000, 1000), 30000);
        this.requireTls = String(process.env.GO_OPS_REQUIRE_TLS || "false").trim().toLowerCase() === "true";
        this.requireServiceAssertion = String(process.env.GO_OPS_REQUIRE_SERVICE_ASSERTION || "true").trim().toLowerCase() === "true";
        this.serviceAssertionScope = String(process.env.GO_OPS_SERVICE_ASSERTION_SCOPE || "service-events:write").trim() || "service-events:write";
        this.tlsServerName = String(process.env.GO_OPS_TLS_SERVERNAME || "").trim();
        this.clientCert = secrets.getEnvOrFile("GO_OPS_CLIENT_CERT", { required: false, defaultValue: "" });
        this.clientKey = secrets.getEnvOrFile("GO_OPS_CLIENT_KEY", { required: false, defaultValue: "" });
        this.caCert = secrets.getEnvOrFile("GO_OPS_CA_CERT", { required: false, defaultValue: "" });
        this.assertionPrivateKey = secrets.getEnvOrFile("SERVICE_ASSERTION_PRIVATE_KEY", { required: false, defaultValue: "" });
        this.assertionIssuer = String(process.env.SERVICE_ASSERTION_ISSUER || "filspresso-backend").trim();
        this.assertionSubject = String(process.env.SERVICE_ASSERTION_SUBJECT || "backend").trim();
        this.assertionTtlSeconds = Math.min(Math.max(Number.parseInt(process.env.SERVICE_ASSERTION_TTL_SECONDS || "120", 10) || 120, 30), 600);
        // Validate egress target at startup
        egressPolicy.assertAllowedEgress(this.goOpsUrl, "GO_OPS_URL");
    }
    getHttpsAgent() {
        if (!this.clientCert && !this.clientKey && !this.caCert)
            return undefined;
        if (!this.httpsAgent) {
            this.httpsAgent = new https.Agent({
                cert: this.clientCert || undefined,
                key: this.clientKey || undefined,
                ca: this.caCert || undefined,
                rejectUnauthorized: true,
                servername: this.tlsServerName || undefined,
                keepAlive: true,
            });
        }
        return this.httpsAgent;
    }
    createServiceAssertionToken(operationId) {
        if (!this.assertionPrivateKey)
            return "";
        try {
            const issued = serviceAssertionUtils.issueServiceAssertion({
                privateKeyPem: this.assertionPrivateKey,
                issuer: this.assertionIssuer,
                subject: this.assertionSubject,
                scope: this.serviceAssertionScope,
                ttlSeconds: this.assertionTtlSeconds,
                operationId,
                keyPurpose: "service_assertion_signing",
                operationType: "issue_service_assertion",
            });
            return issued.token;
        }
        catch (error) {
            this.logger.warn(`Failed to issue service assertion: ${error instanceof Error ? error.message : String(error)}`);
            return "";
        }
    }
    requestJson(targetUrl, options) {
        const parsed = new URL(targetUrl);
        const isHttps = parsed.protocol === "https:";
        if (this.requireTls && !isHttps) {
            throw new Error("GO_OPS_REQUIRE_TLS is true but GO_OPS_URL is not https");
        }
        const transport = isHttps ? https : http;
        const payload = options.body ? JSON.stringify(options.body) : null;
        const headers = { Accept: "application/json", ...(options.headers || {}) };
        if (payload) {
            headers["Content-Type"] = "application/json";
            headers["Content-Length"] = Buffer.byteLength(payload);
        }
        return new Promise((resolve, reject) => {
            const reqOptions = {
                method: options.method || "GET",
                hostname: parsed.hostname,
                port: parsed.port || (isHttps ? 443 : 80),
                path: `${parsed.pathname}${parsed.search}`,
                headers: headers,
                timeout: this.goOpsTimeoutMs,
            };
            if (isHttps) {
                const agent = this.getHttpsAgent();
                if (agent)
                    reqOptions.agent = agent;
            }
            const req = transport.request(reqOptions, (res) => {
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    const rawBody = Buffer.concat(chunks).toString("utf8");
                    let parsedBody = null;
                    if (rawBody) {
                        try {
                            parsedBody = JSON.parse(rawBody);
                        }
                        catch {
                            parsedBody = rawBody;
                        }
                    }
                    resolve({ status: res.statusCode ?? 0, body: parsedBody, rawBody });
                });
            });
            req.on("timeout", () => { req.destroy(new Error("go_ops request timed out")); });
            req.on("error", reject);
            if (payload)
                req.write(payload);
            req.end();
        });
    }
    async healthCheck() {
        try {
            const result = await this.requestJson(`${this.goOpsUrl}/health`, { method: "GET" });
            if (result.status < 200 || result.status >= 300) {
                throw new common_1.ServiceUnavailableException({ error: "Go ops service is unavailable" });
            }
            return { upstream: result.body };
        }
        catch (error) {
            if (error instanceof common_1.ServiceUnavailableException)
                throw error;
            throw new common_1.ServiceUnavailableException({ error: "Failed to reach go ops service" });
        }
    }
    async ingestEvent(accountId, operationId, body) {
        const eventType = String(body?.eventType || "").trim();
        if (!eventType)
            throw new common_1.BadRequestException({ error: "eventType is required" });
        const payload = {
            eventType,
            source: "nestjs",
            operationId,
            payload: { ...body?.payload, accountId, at: new Date().toISOString(), operationId },
        };
        serviceContracts.assertServiceContract("go_ops_event_ingest_v1", payload);
        const serviceAssertion = this.createServiceAssertionToken(operationId);
        if (this.requireServiceAssertion && !serviceAssertion) {
            throw new common_1.InternalServerErrorException({ error: "go_ops service assertion is required but could not be issued" });
        }
        const headers = { "x-service-name": "filspresso-backend", "x-operation-id": operationId };
        if (this.goOpsApiKey)
            headers["x-ops-key"] = this.goOpsApiKey;
        if (serviceAssertion)
            headers["x-service-assertion"] = serviceAssertion;
        const upstream = await this.requestJson(`${this.goOpsUrl}/events/ingest`, { method: "POST", headers, body: payload });
        if (upstream.status < 200 || upstream.status >= 300) {
            this.logger.error(`Go ops ingest error: ${String(upstream.rawBody || upstream.body || "")}`);
            throw new common_1.ServiceUnavailableException({ error: "Failed to ingest operational event" });
        }
        return { accepted: true, operationId, upstream: upstream.body };
    }
};
exports.OperationsService = OperationsService;
exports.OperationsService = OperationsService = OperationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], OperationsService);
