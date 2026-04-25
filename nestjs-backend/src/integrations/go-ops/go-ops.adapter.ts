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

	async health(): Promise<Record<string, unknown>> {
		const response = await fetch(`${this.baseUrl}/health`, {
			method: "GET",
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			throw new Error(`go-ops health failed with ${response.status}`);
		}

		return (await response.json()) as Record<string, unknown>;
	}

	async ingestEvent(payload: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
		const response = await fetch(`${this.baseUrl}/events/ingest`, {
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
