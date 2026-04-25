import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class RustCryptoAdapter {
	private readonly baseUrl: string;
	private readonly timeoutMs: number;

	constructor(private readonly configService: ConfigService) {
		this.baseUrl = String(this.configService.get<string>("integrations.rustCryptoUrl") || "http://localhost:8090").replace(
			/\/$/,
			"",
		);
		this.timeoutMs = Math.min(
			Math.max(Number.parseInt(process.env.RUST_CRYPTO_TIMEOUT_MS || "4000", 10) || 4000, 1000),
			15000,
		);
	}

	private async request<T>(path: string, init: RequestInit): Promise<T> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

		try {
			const response = await fetch(`${this.baseUrl}${path}`, {
				...init,
				signal: controller.signal,
				headers: {
					Accept: "application/json",
					...(init.body ? { "Content-Type": "application/json" } : {}),
					...(init.headers || {}),
				},
			});

			if (!response.ok) {
				throw new Error(`rust-crypto request failed with ${response.status}`);
			}

			return (await response.json()) as T;
		} finally {
			clearTimeout(timeout);
		}
	}

	health(): Promise<Record<string, unknown>> {
		return this.request<Record<string, unknown>>("/health", { method: "GET" });
	}

	commitment(payload: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
		return this.request<Record<string, unknown>>("/commitment", {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
	}

	verify(payload: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
		return this.request<Record<string, unknown>>("/verify", {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
	}
}
