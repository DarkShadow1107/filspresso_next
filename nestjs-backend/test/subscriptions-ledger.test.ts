import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { SubscriptionsService } from "../src/subscriptions/subscriptions.service";
import type { DatabaseService } from "../src/database/database.service";
import type { ChargeProvider } from "../src/billing/charge-provider";

test("simulated subscription checkout stores a linked payment and safe card snapshot", async () => {
	const calls: Array<{ sql: string; params: unknown[] }> = [];
	let released = false;
	const client = {
		query: async (sql: string, params: unknown[] = []) => {
			calls.push({ sql, params });
			if (sql.includes("INSERT INTO user_subscriptions")) return { rows: [{ id: 501 }] };
			if (sql.includes("SELECT id FROM user_cards")) return { rows: [{ id: 9 }] };
			return { rows: [], rowCount: 0 };
		},
		release: () => { released = true; },
	};
	const pool = {
		connect: async () => client,
		query: async () => ({ rows: [], rowCount: 0 }),
	};
	const service = new SubscriptionsService({} as ChargeProvider, { getPool: () => pool } as unknown as DatabaseService);

	const result = await service.createSubscription(42, {
		tier: "ultimate", billingCycle: "monthly", cardId: 9, cardLastFour: "4242", cardType: "Visa",
	});
	const payment = calls.find(call => call.sql.includes("INSERT INTO subscription_payments"));
	assert.ok(payment, "a payment ledger row is written with the subscription");
	assert.ok(payment.sql.includes("subscription_id, card_last_four_snapshot, card_type_snapshot"));
	assert.equal(payment.params[7], 501);
	assert.equal(payment.params[8], "4242");
	assert.equal(payment.params[9], "Visa");
	assert.equal(result.price_ron, 599.99);
	assert.equal(released, true);
});

test("Manage Subscription shows the card snapshot when the card was not saved", async () => {
	let released = false;
	const client = {
		query: async (sql: string) => {
			if (sql.includes("us.status IN ('active', 'ending')")) {
				return { rows: [{
					id: 501, subscription_tier: "ultimate", billing_cycle: "monthly", price_ron: "599.99",
					is_active: true, auto_renew: true, status: "active", card_id: null,
					card_last_four_snapshot: "4242", card_type_snapshot: "Visa",
				}] };
			}
			return { rows: [] };
		},
		release: () => { released = true; },
	};
	const service = new SubscriptionsService(
		{} as ChargeProvider,
		{ getPool: () => ({ connect: async () => client }) } as unknown as DatabaseService,
	);
	const result = await service.getSubscription(42);
	assert.deepEqual(result.subscription.card, { id: null, last_four: "4242", type: "Visa" });
	assert.equal(released, true);
});

test("renewal scheduler locks subscriptions only when joining saved card metadata", async () => {
	const queries: string[] = [];
	let released = false;
	const client = {
		query: async (sql: string) => {
			queries.push(sql);
			return { rows: [] };
		},
		release: () => { released = true; },
	};
	const service = new SubscriptionsService(
		{} as ChargeProvider,
		{ getPool: () => ({ connect: async () => client }) } as unknown as DatabaseService,
	);

	assert.equal(await service.renewDueSubscriptions(), 0);
	assert.ok(queries.some(sql => sql.includes("FOR UPDATE OF us SKIP LOCKED")));
	assert.equal(released, true);
});
