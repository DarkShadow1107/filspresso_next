import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { ServiceAssertionService } from "../security/assertions/service-assertion.service";

interface ServiceEventsRequest extends Request {
	serviceIdentity?: {
		actor_type: string;
		service_name: string;
		role: string;
	};
	serviceAssertion?: Record<string, unknown>;
}

@Injectable()
export class ServiceEventsAuthGuard implements CanActivate {
	private readonly serviceEventsApiKey = String(process.env.SERVICE_EVENTS_API_KEY || "");
	private readonly internalServiceAssertionStrict =
		String(process.env.INTERNAL_SERVICE_ASSERTION_STRICT || "true")
			.trim()
			.toLowerCase() === "true";

	constructor(private readonly serviceAssertionService: ServiceAssertionService) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<ServiceEventsRequest>();

		const serviceName =
			String(request.headers["x-service-name"] || "")
				.trim()
				.slice(0, 128) || "service-events-client";
		const assertionHeader = String(request.headers["x-service-assertion"] || "").trim();
		const authHeader = String(request.headers.authorization || "").trim();
		const assertionAuthorization = authHeader.startsWith("Assertion ") ? authHeader.slice(10).trim() : "";
		const assertionToken = assertionHeader || assertionAuthorization;
		const operationIdHeader = String(request.headers["x-operation-id"] || "").trim();

		if (this.internalServiceAssertionStrict && !assertionToken) {
			throw new UnauthorizedException({ error: "Service assertion token required" });
		}

		if (!this.serviceEventsApiKey && !assertionToken) {
			throw new ServiceUnavailableException({ error: "Service events ingestion is disabled" });
		}

		if (assertionToken) {
			const assertion = this.serviceAssertionService.verify(
				assertionToken,
				"service-events:write",
				this.internalServiceAssertionStrict,
			);
			if (assertion.ok) {
				const claims =
					assertion.claims && typeof assertion.claims === "object" ? (assertion.claims as Record<string, unknown>) : {};
				const operationIdClaim = String(claims.op_id || "").trim();
				if (
					this.internalServiceAssertionStrict &&
					operationIdHeader &&
					operationIdClaim &&
					operationIdHeader !== operationIdClaim
				) {
					throw new UnauthorizedException({
						error: "Invalid service assertion",
						reason: "operation_id_mismatch",
					});
				}

				request.serviceIdentity = {
					actor_type: "service",
					service_name: String(claims.sub || serviceName).slice(0, 128),
					role: "service",
				};
				request.serviceAssertion = claims;
				return true;
			}

			if (this.internalServiceAssertionStrict || !this.serviceEventsApiKey) {
				throw new UnauthorizedException({
					error: "Invalid service assertion",
					reason: assertion.reason || "verification_failed",
				});
			}
		}

		if (this.internalServiceAssertionStrict) {
			throw new UnauthorizedException({
				error: "Invalid service assertion",
				reason: "assertion_required",
			});
		}

		const headerKey = String(request.headers["x-service-events-key"] || "").trim();
		if (headerKey && headerKey === this.serviceEventsApiKey) {
			request.serviceIdentity = {
				actor_type: "service",
				service_name: serviceName,
				role: "service",
			};
			return true;
		}

		if (authHeader.startsWith("Bearer ")) {
			const bearerKey = authHeader.slice(7).trim();
			if (bearerKey === this.serviceEventsApiKey) {
				request.serviceIdentity = {
					actor_type: "service",
					service_name: serviceName,
					role: "service",
				};
				return true;
			}
		}

		throw new UnauthorizedException({ error: "Unauthorized service events request" });
	}
}
