import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { membershipPeriod, nextTierAfter, tierForCapsules } from "../src/orders/orders.service";

const { describe, it } = test;

const ROOT = path.resolve(__dirname, "..", "..");
const FRONTEND = readFileSync(
	path.join(ROOT, "src", "components", "account", "sections", "types.ts"),
	"utf8",
);

/**
 * The Member Status tab.
 *
 * It used to ask the backend for four numbers and then read a much larger object off
 * the answer: `capsuleStats.currentPeriod.capsules` on a payload that had no such
 * field, a tier *object* where the backend sent a tier *name*, and a
 * `consumption-history` endpoint that did not exist. Selecting the tab threw, and
 * the account page went down with it.
 *
 * So the shape is now the backend's, and these tests check that the two sides still
 * agree -- the ladder the backend computes against and the ladder the account page
 * draws with.
 */

describe("the membership ladder", () => {
	it("matches the one the account page draws", () => {
		// The frontend's ladder, read out of its own table.
		const start = FRONTEND.indexOf("export const TIER_THRESHOLDS");
		assert.notEqual(start, -1, "TIER_THRESHOLDS not found in the account types");
		const end = FRONTEND.indexOf("];", start);
		const literal = FRONTEND.slice(start, end);
		const thresholds = [...literal.matchAll(/tier:\s*"([^"]+)",\s*min:\s*(\d+)/g)].map((m) => ({
			tier: m[1],
			min: Number(m[2]),
		}));
		assert.equal(thresholds.length, 6, `parsed ${thresholds.length} tiers`);

		for (const { tier, min } of thresholds) {
			assert.equal(tierForCapsules(min).name, tier, `${min} capsules should be ${tier}`);
			// One capsule below the threshold is still the tier below.
			if (min > 1) {
				assert.notEqual(tierForCapsules(min - 1).name, tier, `${min - 1} capsules is not ${tier}`);
			}
		}
	});

	it("counts from zero, not from one", () => {
		assert.equal(tierForCapsules(0).name, "None");
		assert.equal(tierForCapsules(0).level, 0);
		assert.equal(tierForCapsules(1).name, "Connoisseur");
	});

	it("never narrows as the count rises", () => {
		let previous = tierForCapsules(0).level;
		for (let capsules = 0; capsules <= 9000; capsules += 37) {
			const level = tierForCapsules(capsules).level;
			assert.ok(level >= previous, `the tier went down at ${capsules} capsules`);
			previous = level;
		}
	});

	it("knows which tier comes next, and how far away it is", () => {
		const next = nextTierAfter(50);
		assert.equal(next?.name, "Expert");
		assert.equal(next?.needed, 750);
		assert.equal(next?.remaining, 700);
	});

	it("has no next tier at the top", () => {
		assert.equal(nextTierAfter(7000), null);
		assert.equal(nextTierAfter(999999), null);
	});
});

describe("the membership year", () => {
	it("runs from the account's own anniversary", () => {
		const created = new Date("2024-03-15T09:30:00.000Z");
		const period = membershipPeriod(created, new Date("2025-10-21T12:00:00.000Z"));
		assert.equal(period.start.toISOString().slice(0, 10), "2025-03-15");
		assert.equal(period.end.toISOString().slice(0, 10), "2026-03-15");
	});

	it("rolls forward a year at a time", () => {
		const created = new Date("2024-03-15T09:30:00.000Z");
		const period = membershipPeriod(created, new Date("2026-10-21T12:00:00.000Z"));
		assert.equal(period.start.toISOString().slice(0, 10), "2026-03-15");
		assert.equal(period.end.toISOString().slice(0, 10), "2027-03-15");
		assert.ok(period.daysRemaining > 0 && period.daysRemaining <= 366);
	});

	it("does not run backwards for an account created in the future", () => {
		const created = new Date("2027-01-01T00:00:00.000Z");
		const period = membershipPeriod(created, new Date("2026-10-21T12:00:00.000Z"));
		assert.ok(period.end > period.start);
	});
});
