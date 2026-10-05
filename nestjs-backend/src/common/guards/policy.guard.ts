import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { POLICY_METADATA_KEY, type PolicyContext } from "../decorators/policy.decorator";
import type { RequestWithId } from "../middleware/request-id.middleware";
import { OpaPolicyService } from "../../security/policy/opa-policy.service";
import { resolveClientIp } from "../utils/client-ip";
import type { Request } from "express";

interface IdentityRequest extends RequestWithId {
	user?: { id?: number; username?: string; role?: string };
	adminSession?: { userId?: number; username?: string };
	serviceIdentity?: { actor_type?: string; service_name?: string; role?: string };
}

function getRequestIp(req: IdentityRequest): string | null {
  // Phase 10 review. This used to read `x-forwarded-for` and `x-real-ip` directly, so
  // the value sent to OPA as an identity input was whatever the caller asserted.
  //
  // Checked before changing it: `security/opa/policies/filspresso-authz.rego` never
  // references an ip field. Every rule keys on `input.resource`, `input.path` and
  // `input.identity.{actor_type,role,username}`. So this is an audit field only and the
  // change is behaviourally inert -- which is why it can be made without a policy
  // review, and why it should not have been left trusting a header in the meantime.
  const resolved = resolveClientIp(req as unknown as Request);
  return resolved || null;
}

function normalizePath(req: IdentityRequest): string {
	const raw = String(req.originalUrl || req.url || "");
	return raw.split("?")[0] || "/";
}

function buildIdentity(req: IdentityRequest): Record<string, unknown> {
	if (req.serviceIdentity && typeof req.serviceIdentity === "object") {
		return {
			actor_type: req.serviceIdentity.actor_type || "service",
			service_name: req.serviceIdentity.service_name || null,
			role: req.serviceIdentity.role || "service",
		};
	}

	if (req.adminSession) {
		return {
			actor_type: "admin-user",
			account_id: req.adminSession.userId || null,
			username: req.adminSession.username || null,
			role: "admin",
		};
	}

	if (req.user) {
		return {
			actor_type: "user",
			account_id: req.user.id || null,
			username: req.user.username || null,
			role: req.user.role || "user",
		};
	}

	const serviceName = String(req.headers["x-service-name"] || "").trim();
	if (serviceName) {
		return {
			actor_type: "service",
			service_name: serviceName.slice(0, 128),
			role: "service",
		};
	}

	return {
		actor_type: "anonymous",
		role: "anonymous",
	};
}

@Injectable()
export class PolicyGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly opaPolicyService: OpaPolicyService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const classContext = this.reflector.get<PolicyContext | undefined>(POLICY_METADATA_KEY, context.getClass());
		const handlerContext = this.reflector.get<PolicyContext | undefined>(POLICY_METADATA_KEY, context.getHandler());
		const policyContext = handlerContext || classContext;

		if (!policyContext) {
			return true;
		}

		const request = context.switchToHttp().getRequest<IdentityRequest>();
		const decision = await this.opaPolicyService.evaluate({
			resource: policyContext.resource,
			action: policyContext.action,
			method: String(request.method || "GET").toUpperCase(),
			path: normalizePath(request),
			ipAddress: getRequestIp(request),
			requestId: request.requestId,
			identity: buildIdentity(request),
		});

		if (!decision.allow) {
			throw new ForbiddenException({
				error: "Policy denied request",
				reason: decision.reason,
				requestId: request.requestId,
			});
		}

		return true;
	}
}
