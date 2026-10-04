import { fetchBounded, readIntEnv } from "../../common/utils/httpClient";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class KotlinSubscriptionsAdapter {
	private readonly baseUrl: string;

	constructor(private readonly configService: ConfigService) {
		this.baseUrl = String(
			this.configService.get<string>("integrations.kotlinSubscriptionsUrl") || "http://localhost:8084",
		).replace(/\/$/, "");
	}

	/**
	 * Deadline for calls to the kotlin-subscriptions service.
	 *
	 * Phase 7.6: this adapter had no timeout at all. It is registered as a global
	 * provider, so the moment anything injects it, a kotlin-subscriptions that accepted the
	 * connection and then stalled would hang the caller forever.
	 */
	private readonly timeoutMs = readIntEnv("KOTLIN_SUBSCRIPTIONS_TIMEOUT_MS", 5000, 500, 60000);

	/**
	 * Ceiling on a buffered kotlin-subscriptions response, so a runaway peer cannot exhaust the heap.
	 */
	private readonly maxResponseBytes = readIntEnv("KOTLIN_SUBSCRIPTIONS_MAX_RESPONSE_BYTES", 65536, 1024, 64 * 1024 * 1024);


	async health(): Promise<Record<string, unknown>> {
		const response = await fetchBounded(`${this.baseUrl}/api/subscriptions/health`, {
			timeoutMs: this.timeoutMs,
			maxBytes: this.maxResponseBytes,
			method: "GET",
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			throw new Error(`kotlin-subscriptions health failed with ${response.status}`);
		}

		return (await response.json()) as Record<string, unknown>;
	}

	async quote(payload: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
		const response = await fetchBounded(`${this.baseUrl}/api/subscriptions/quote`, {
			timeoutMs: this.timeoutMs,
			maxBytes: this.maxResponseBytes,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				...headers,
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			throw new Error(`kotlin-subscriptions quote failed with ${response.status}`);
		}

		return (await response.json()) as Record<string, unknown>;
	}
}
