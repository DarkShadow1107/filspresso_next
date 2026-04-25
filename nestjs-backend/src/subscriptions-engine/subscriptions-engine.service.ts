import {
  Injectable, Logger, ServiceUnavailableException,
} from "@nestjs/common";
import * as serviceAssertionUtils from "../common/utils/serviceAssertions";
import * as serviceContracts from "../common/utils/serviceContracts";
import * as egressPolicy from "../common/utils/egressPolicy";

@Injectable()
export class SubscriptionsEngineService {
  private readonly logger = new Logger(SubscriptionsEngineService.name);
  private readonly kotlinSubsUrl: string;
  private readonly requireServiceAssertion: boolean;
  private readonly serviceAssertionScope: string;
  private readonly assertionPrivateKey: string;
  private readonly assertionIssuer: string;
  private readonly assertionSubject: string;
  private readonly assertionTtlSeconds: number;
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
    } catch (e) {
      this.logger.warn(`Egress policy check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private buildUpstreamHeaders(base: Record<string, string> = {}): Record<string, string> | null {
    if (!this.assertionPrivateKey) return this.requireServiceAssertion ? null : base;
    try {
      const issued = serviceAssertionUtils.issueServiceAssertion({
        privateKeyPem: this.assertionPrivateKey, issuer: this.assertionIssuer,
        subject: this.assertionSubject, scope: this.serviceAssertionScope,
        ttlSeconds: this.assertionTtlSeconds,
      });
      return { ...base, "x-service-name": "filspresso-backend", "x-service-assertion": issued.token };
    } catch (e) {
      this.logger.warn(`Failed to issue subscription service assertion: ${e instanceof Error ? e.message : String(e)}`);
      return this.requireServiceAssertion ? null : base;
    }
  }

  async getHealth(): Promise<unknown> {
    const headers = this.buildUpstreamHeaders({ Accept: "application/json" });
    if (!headers) throw new ServiceUnavailableException({ error: "Subscription service assertion is required but could not be issued" });
    const upstream = await fetch(`${this.kotlinSubsUrl}/api/subscriptions/health`, { headers });
    if (!upstream.ok) throw new ServiceUnavailableException({ error: "Kotlin subscription service unavailable" });
    const data = await upstream.json();
    return { upstream: data };
  }

  async getQuote(user: Record<string, unknown>, body: Record<string, unknown>): Promise<unknown> {
    const headers = this.buildUpstreamHeaders({ "Content-Type": "application/json", Accept: "application/json" });
    if (!headers) throw new ServiceUnavailableException({ error: "Subscription service assertion is required but could not be issued" });
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
      throw new ServiceUnavailableException({ error: "Subscription quote engine failed" });
    }
    const quote = await upstream.json();
    serviceContracts.assertServiceContract("kotlin_quote_response_v1", { quote });
    return { quote };
  }
}
