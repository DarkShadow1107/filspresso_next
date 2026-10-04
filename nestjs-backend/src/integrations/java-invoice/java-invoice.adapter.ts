import { fetchBounded, readIntEnv } from "../../common/utils/httpClient";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class JavaInvoiceAdapter {
	private readonly baseUrl: string;

	constructor(private readonly configService: ConfigService) {
		this.baseUrl = String(
			this.configService.get<string>("integrations.invoiceServiceUrl") || "http://localhost:8082",
		).replace(/\/$/, "");
	}

	/**
	 * Deadline for calls to the invoice service service.
	 *
	 * Phase 7.6: this adapter had no timeout at all. It is registered as a global
	 * provider, so the moment anything injects it, a invoice service that accepted the
	 * connection and then stalled would hang the caller forever.
	 */
	private readonly timeoutMs = readIntEnv("INVOICE_TIMEOUT_MS", 10000, 500, 60000);

	/**
	 * Ceiling on a buffered invoice service response, so a runaway peer cannot exhaust the heap.
	 */
	private readonly maxResponseBytes = readIntEnv("INVOICE_MAX_RESPONSE_BYTES", 8388608, 1024, 64 * 1024 * 1024);


	async health(): Promise<Record<string, unknown>> {
		const response = await fetchBounded(`${this.baseUrl}/api/invoices/health`, {
			timeoutMs: this.timeoutMs,
			maxBytes: this.maxResponseBytes,
			method: "GET",
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			throw new Error(`invoice service health failed with ${response.status}`);
		}

		return (await response.json()) as Record<string, unknown>;
	}

	async renderPdf(payload: Record<string, unknown>, headers: Record<string, string> = {}): Promise<ArrayBuffer> {
		const response = await fetchBounded(`${this.baseUrl}/api/invoices/render`, {
			timeoutMs: this.timeoutMs,
			maxBytes: this.maxResponseBytes,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/pdf",
				...headers,
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			throw new Error(`invoice render failed with ${response.status}`);
		}

		return response.arrayBuffer();
	}
}
