import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { OrdersService } from "../src/orders/orders.service";
import type { DatabaseService } from "../src/database/database.service";
import type { FxRatesService } from "../src/orders/fx-rates.service";

test("account spending includes subscription ledger totals alongside orders", async () => {
	const queries: string[] = [];
	let released = false;
	const client = {
		query: async (sql: string, params: unknown[]) => {
			queries.push(sql);
			assert.deepEqual(params, [42]);
			if (sql.includes("subscription_payments")) return { rows: [{ subscription_total: "599.99" }] };
			if (sql.includes("GROUP BY")) return { rows: [] };
			return { rows: [{ orders_total: "25.00" }] };
		},
		release: () => { released = true; },
	};
	const db = { getPool: () => ({ connect: async () => client }) } as unknown as DatabaseService;
	const service = new OrdersService(db, {} as FxRatesService);
	const result = await service.getUserSpending(42) as { spending: { orders: number; subscriptions: number; total: number } };
	assert.deepEqual(result.spending, { orders: 25, subscriptions: 599.99, total: 624.99 });
	assert.ok(queries.some(sql => sql.includes("payment_status = 'refunded'")));
	assert.equal(released, true);
});
