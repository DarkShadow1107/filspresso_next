import test from "node:test";
import assert from "node:assert/strict";
import type { ExecutionContext } from "@nestjs/common";
import { ServiceEventsAuthGuard } from "../src/security-observability/service-events-auth.guard";

interface ServiceAssertionResult {
	ok: boolean;
	reason?: string;
	claims?: Record<string, unknown>;
}

class ServiceAssertionServiceMock {
	constructor(private readonly result: ServiceAssertionResult) {}

	verify(): ServiceAssertionResult {
		return this.result;
	}
}

function createExecutionContext(request: Record<string, unknown>): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: <T>() => request as T,
			getResponse: () => ({}),
			getNext: () => undefined,
		}),
	} as unknown as ExecutionContext;
}

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
	const originalValues: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(overrides)) {
		originalValues[key] = process.env[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}

	try {
		fn();
	} finally {
		for (const [key, value] of Object.entries(originalValues)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

test("strict mode requires assertion token", () => {
	withEnv(
		{
			INTERNAL_SERVICE_ASSERTION_STRICT: "true",
			SERVICE_EVENTS_API_KEY: "legacy-key",
		},
		() => {
			const guard = new ServiceEventsAuthGuard(new ServiceAssertionServiceMock({ ok: false }) as never);
			const request = { headers: {} };
			const context = createExecutionContext(request);

			assert.throws(() => guard.canActivate(context));
		},
	);
});

test("non-strict mode accepts x-service-events-key fallback", () => {
	withEnv(
		{
			INTERNAL_SERVICE_ASSERTION_STRICT: "false",
			SERVICE_EVENTS_API_KEY: "legacy-key",
		},
		() => {
			const guard = new ServiceEventsAuthGuard(
				new ServiceAssertionServiceMock({ ok: false, reason: "bad_signature" }) as never,
			);

			const request: Record<string, unknown> = {
				headers: {
					"x-service-events-key": "legacy-key",
					"x-service-name": "test-client",
				},
			};
			const context = createExecutionContext(request);

			assert.equal(guard.canActivate(context), true);
			assert.deepEqual(request.serviceIdentity, {
				actor_type: "service",
				service_name: "test-client",
				role: "service",
			});
		},
	);
});

test("strict mode accepts valid assertion and propagates service identity", () => {
	withEnv(
		{
			INTERNAL_SERVICE_ASSERTION_STRICT: "true",
			SERVICE_EVENTS_API_KEY: "",
		},
		() => {
			const guard = new ServiceEventsAuthGuard(
				new ServiceAssertionServiceMock({
					ok: true,
					claims: {
						sub: "asserted-service",
						op_id: "op-123",
					},
				}) as never,
			);

			const request: Record<string, unknown> = {
				headers: {
					"x-service-assertion": "signed-token",
					"x-operation-id": "op-123",
					"x-service-name": "fallback-service",
				},
			};
			const context = createExecutionContext(request);

			assert.equal(guard.canActivate(context), true);
			assert.deepEqual(request.serviceIdentity, {
				actor_type: "service",
				service_name: "asserted-service",
				role: "service",
			});
			assert.deepEqual(request.serviceAssertion, {
				sub: "asserted-service",
				op_id: "op-123",
			});
		},
	);
});
