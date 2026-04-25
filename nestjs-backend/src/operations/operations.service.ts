import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as http from "node:http";
import * as https from "node:https";
import { ConfigService } from "@nestjs/config";
import * as serviceAssertionUtils from "../common/utils/serviceAssertions";
import * as serviceContracts from "../common/utils/serviceContracts";
import * as secrets from "../common/utils/secrets";
import * as egressPolicy from "../common/utils/egressPolicy";

@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);
  private readonly goOpsUrl: string;
  private readonly goOpsApiKey: string;
  private readonly goOpsTimeoutMs: number;
  private readonly requireTls: boolean;
  private readonly requireServiceAssertion: boolean;
  private readonly serviceAssertionScope: string;
  private readonly tlsServerName: string;
  private readonly clientCert: string;
  private readonly clientKey: string;
  private readonly caCert: string;
  private readonly assertionPrivateKey: string;
  private readonly assertionIssuer: string;
  private readonly assertionSubject: string;
  private readonly assertionTtlSeconds: number;
  private httpsAgent: https.Agent | undefined;

  constructor(_config: ConfigService) {

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

  private getHttpsAgent(): https.Agent | undefined {
    if (!this.clientCert && !this.clientKey && !this.caCert) return undefined;
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

  private createServiceAssertionToken(operationId: string): string {
    if (!this.assertionPrivateKey) return "";
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
    } catch (error) {
      this.logger.warn(`Failed to issue service assertion: ${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
  }

  private requestJson(targetUrl: string, options: { method?: string; headers?: Record<string, unknown>; body?: unknown }): Promise<{ status: number; body: unknown; rawBody: string }> {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === "https:";
    if (this.requireTls && !isHttps) {
      throw new Error("GO_OPS_REQUIRE_TLS is true but GO_OPS_URL is not https");
    }
    const transport: typeof http | typeof https = isHttps ? https : http;
    const payload = options.body ? JSON.stringify(options.body) : null;
    const headers: Record<string, unknown> = { Accept: "application/json", ...(options.headers || {}) };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    return new Promise((resolve, reject) => {
      const reqOptions: http.RequestOptions = {
        method: options.method || "GET",
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: headers as Record<string, string>,
        timeout: this.goOpsTimeoutMs,
      };
      if (isHttps) {
        const agent = this.getHttpsAgent();
        if (agent) (reqOptions as https.RequestOptions).agent = agent;
      }
      const req = (transport.request as typeof http.request)(reqOptions as http.RequestOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          let parsedBody: unknown = null;
          if (rawBody) { try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = rawBody; } }
          resolve({ status: res.statusCode ?? 0, body: parsedBody, rawBody });
        });
      });
      req.on("timeout", () => { req.destroy(new Error("go_ops request timed out")); });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async healthCheck(): Promise<{ upstream: unknown }> {
    try {
      const result = await this.requestJson(`${this.goOpsUrl}/health`, { method: "GET" });
      if (result.status < 200 || result.status >= 300) {
        throw new ServiceUnavailableException({ error: "Go ops service is unavailable" });
      }
      return { upstream: result.body };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({ error: "Failed to reach go ops service" });
    }
  }

  async ingestEvent(accountId: number, operationId: string, body: { eventType?: string; payload?: Record<string, unknown> }): Promise<{ accepted: boolean; operationId: string; upstream: unknown }> {
    const eventType = String(body?.eventType || "").trim();
    if (!eventType) throw new BadRequestException({ error: "eventType is required" });

    const payload = {
      eventType,
      source: "nestjs",
      operationId,
      payload: { ...body?.payload, accountId, at: new Date().toISOString(), operationId },
    };

    serviceContracts.assertServiceContract("go_ops_event_ingest_v1", payload);

    const serviceAssertion = this.createServiceAssertionToken(operationId);
    if (this.requireServiceAssertion && !serviceAssertion) {
      throw new InternalServerErrorException({ error: "go_ops service assertion is required but could not be issued" });
    }

    const headers: Record<string, string> = { "x-service-name": "filspresso-backend", "x-operation-id": operationId };
    if (this.goOpsApiKey) headers["x-ops-key"] = this.goOpsApiKey;
    if (serviceAssertion) headers["x-service-assertion"] = serviceAssertion;

    const upstream = await this.requestJson(`${this.goOpsUrl}/events/ingest`, { method: "POST", headers, body: payload });
    if (upstream.status < 200 || upstream.status >= 300) {
      this.logger.error(`Go ops ingest error: ${String(upstream.rawBody || upstream.body || "")}`);
      throw new ServiceUnavailableException({ error: "Failed to ingest operational event" });
    }
    return { accepted: true, operationId, upstream: upstream.body };
  }
}
