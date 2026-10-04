import { fetchBounded, readIntEnv } from "../../common/utils/httpClient";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class GoOpsAdapter {
	private readonly baseUrl: string;

	constructor(private readonly configService: ConfigService) {
		this.baseUrl = String(this.configService.get<string>("integrations.goOpsUrl") || "http://localhost:8083").replace(
			/\/$/,
			"",
		);
	}

	/**
	 * Deadline for calls to the go-ops service.
	 *
	 * Phase 7.6: this adapter had no timeout at all. It is registered as a global
	 * provider, so the moment anything injects it, a go-ops that accepted the
	 * connection and then stalled would hang the caller forever.
	 */
	private readonly timeoutMs = readIntEnv("GO_OPS_TIMEOUT_MS", 5000, 500, 60000);

	/**
	 * Ceiling on a buffered go-ops response, so a runaway peer cannot exhaust the heap.
	 */
	private readonly maxResponseBytes = readIntEnv("GO_OPS_MAX_RESPONSE_BYTES", 2097152, 1024, 64 * 1024 * 1024);


	async health(): Promise<Record<string, unknown>> {
		const response = await fetchBounded(`${this.baseUrl}/health`, {
			timeoutMs: this.timeoutMs,
			maxBytes: this.maxResponseBytes,
			method: "GET",
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			throw new Error(`go-ops health failed with ${response.status}`);
		}

		return (await response.json()) as Record<string, unknown>;
	}

	async ingestEvent(payload: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
		const response = await fetchBounded(`${this.baseUrl}/events/ingest`, {
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
			throw new Error(`go-ops ingest failed with ${response.status}`);
		}

		return (await response.json()) as Record<string, unknown>;
	}
}
