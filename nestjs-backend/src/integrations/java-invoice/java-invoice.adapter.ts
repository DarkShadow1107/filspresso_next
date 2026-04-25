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

	async health(): Promise<Record<string, unknown>> {
		const response = await fetch(`${this.baseUrl}/api/invoices/health`, {
			method: "GET",
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			throw new Error(`invoice service health failed with ${response.status}`);
		}

		return (await response.json()) as Record<string, unknown>;
	}

	async renderPdf(payload: Record<string, unknown>, headers: Record<string, string> = {}): Promise<ArrayBuffer> {
		const response = await fetch(`${this.baseUrl}/api/invoices/render`, {
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
