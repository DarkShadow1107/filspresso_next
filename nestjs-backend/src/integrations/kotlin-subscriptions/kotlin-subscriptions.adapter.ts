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

	async health(): Promise<Record<string, unknown>> {
		const response = await fetch(`${this.baseUrl}/api/subscriptions/health`, {
			method: "GET",
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			throw new Error(`kotlin-subscriptions health failed with ${response.status}`);
		}

		return (await response.json()) as Record<string, unknown>;
	}

	async quote(payload: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
		const response = await fetch(`${this.baseUrl}/api/subscriptions/quote`, {
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
