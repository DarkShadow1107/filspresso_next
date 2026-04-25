import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface PolicyInput {
	resource: string;
	action: string;
	method: string;
	path: string;
	ipAddress: string | null;
	requestId: string | undefined;
	identity: Record<string, unknown>;
}

export interface PolicyDecision {
	allow: boolean;
	reason: string;
}

@Injectable()
export class OpaPolicyService {
	constructor(private readonly configService: ConfigService) {}

	async evaluate(input: PolicyInput): Promise<PolicyDecision> {
		const opaUrl = String(this.configService.get<string>("opa.url") || "").trim();
		if (!opaUrl) {
			return { allow: true, reason: "opa_disabled" };
		}

		const timeoutMs = Number(this.configService.get<number>("opa.timeoutMs") || 1500);
		const failClosed = Boolean(this.configService.get<boolean>("opa.failClosed") || false);

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(opaUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({
					input: {
						resource: input.resource,
						action: input.action,
						method: input.method,
						path: input.path,
						ip_address: input.ipAddress,
						request_id: input.requestId,
						identity: input.identity,
					},
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`OPA returned ${response.status}`);
			}

			const data = (await response.json()) as { result?: unknown };
			const result = data?.result;

			if (typeof result === "boolean") {
				return { allow: result, reason: "opa_boolean_result" };
			}

			if (result && typeof result === "object") {
				const typedResult = result as Record<string, unknown>;
				return {
					allow: Boolean(typedResult.allow),
					reason: String(typedResult.reason || "opa_object_result"),
				};
			}

			return { allow: false, reason: "opa_invalid_result" };
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			if (!failClosed) {
				return { allow: true, reason: `opa_error_fail_open:${detail}` };
			}
			return { allow: false, reason: `opa_error_fail_closed:${detail}` };
		} finally {
			clearTimeout(timeout);
		}
	}
}
