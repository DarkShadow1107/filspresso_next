import test from "node:test";
import assert from "node:assert/strict";
import { HealthService } from "../src/health/health.service";

class ConfigServiceMock {
	constructor(private readonly values: Record<string, unknown>) {}

	get<T>(key: string): T | undefined {
		return this.values[key] as T | undefined;
	}
}

class DatabaseServiceMock {
	constructor(private readonly isUp: boolean) {}

	async checkHealth(): Promise<{ isUp: boolean; error: string | null }> {
		return {
			isUp: this.isUp,
			error: this.isUp ? null : "db down",
		};
	}

	/**
	 * Phase 9 V3 added pool occupancy to the payload so the load test could assert on
	 * `waiting`. Stubbed here because the real counters come from `pg`.
	 */
	getPoolStats(): { total: number; idle: number; waiting: number; max: number } {
		return { total: 3, idle: 2, waiting: 0, max: 50 };
	}
}

test("health liveness includes request id", () => {
	const config = new ConfigServiceMock({});
	const db = new DatabaseServiceMock(true);
	const service = new HealthService(config as never, db as never);

	const result = service.getLiveness("req-123");
	assert.equal(result.status, "ok");
	assert.equal(result.requestId, "req-123");
});

test("services health summarizes up services", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => ({ ok: true, status: 200 })) as never;

	try {
		const config = new ConfigServiceMock({
			"health.aiHealthHost": "http://ai:5000",
			"health.adminHealthUrl": "",
			SERVICE_METRICS_STRICT_DB_ONLY: "false",
		});
		const db = new DatabaseServiceMock(true);
		const service = new HealthService(config as never, db as never);

		const result = await service.getServicesHealth("req-abc");
		assert.equal(result.status, "ok");
		assert.equal(result.summary.totalServices, 4);
		assert.equal(result.summary.downServices, 0);
		assert.equal(result.requestId, "req-abc");
		// Phase 9 V3: the load test reads `waiting` from here to prove the pool is not
		// a bottleneck. Counts only -- no DSN or credentials in the payload.
		assert.deepEqual(result.pool, { total: 3, idle: 2, waiting: 0, max: 50 });
	} finally {
		globalThis.fetch = originalFetch;
	}
});
