import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { FINGERPRINT_MAX_LENGTH, isValidFingerprint, parseFingerprint } from "../src/common/utils/fingerprint";

const { describe, it } = test;

const KAFELOT = readFileSync(
	path.resolve(__dirname, "..", "src", "kafelot", "kafelot.controller.ts"),
	"utf8",
);
const BILLING = readFileSync(
	path.resolve(__dirname, "..", "src", "billing", "billing.controller.ts"),
	"utf8",
);

/** What `crypto.randomUUID()` actually produces, so these are not invented shapes. */
const UUIDS = [
	"9f804ce6-e364-4363-aa5b-58c729c8d66f",
	"00000000-0000-4000-8000-000000000000",
	"ffffffff-ffff-4fff-bfff-ffffffffffff",
];

describe("parseFingerprint accepts real version 4 UUIDs", () => {
	for (const uuid of UUIDS) {
		it(`accepts ${uuid}`, () => {
			assert.equal(parseFingerprint(uuid), uuid);
		});
	}
});

describe("parseFingerprint rejects everything else", () => {
	const rejected: Array<[string, unknown]> = [
		["empty string", ""],
		["too short", "abc"],
		["no dashes", "9f804ce6e3644363aa5b58c729c8d66f"],
		["wrong length", "9f804ce6-e364-4363-aa5b-58c729c8d66"],
		["over 36 characters", "a".repeat(37)],
		["way over 36 characters", "a".repeat(200)],
		["the old playground format", "9f804ce6e3644363aa5b58c729c8d66f"],
		["the old coffee fallback", "fp-1700000000000-abc123"],
		["uppercase", "9F804CE6-E364-4363-AA5B-58C729C8D66F"],
		["version 1 not 4", "9f804ce6-e364-1363-aa5b-58c729c8d66f"],
		["bad variant nibble", "9f804ce6-e364-4363-ca5b-58c729c8d66f"],
		["non-hex", "9f804ce6-e364-4363-aa5g-58c729c8d66f"],
		["leading space", " 9f804ce6-e364-4363-aa5b-58c729c8d66f"],
		["trailing space", "9f804ce6-e364-4363-aa5b-58c729c8d66f "],
		["embedded newline", "9f804ce6-e364-4363-aa5b-58c729c8d66f\n"],
		["sql-ish", "'; DROP TABLE ai_token_usage; --"],
		["null", null],
		["undefined", undefined],
		["number", 12345],
		["array", ["9f804ce6-e364-4363-aa5b-58c729c8d66f"]],
		["object", { uuid: "9f804ce6-e364-4363-aa5b-58c729c8d66f" }],
	];

	for (const [label, value] of rejected) {
		it(`rejects ${label}`, () => {
			assert.equal(isValidFingerprint(value), false, `${label} should not validate`);
			assert.throws(() => parseFingerprint(value), /fingerprint/i);
		});
	}
});

describe("rejection is a 400, not a 401", () => {
	it("a malformed fingerprint is a bad request, not an auth failure", () => {
		try {
			parseFingerprint("nope");
			assert.fail("should have thrown");
		} catch (err) {
			// The caller is anonymous *by design*, so 401 would be both wrong and confusing.
			assert.equal((err as { status?: number }).status, 400);
		}
	});
});

describe("nothing is silently repaired", () => {
	it("an over-long value is refused rather than truncated to 36", () => {
		const long = `${"9f804ce6-e364-4363-aa5b-58c729c8d66f"}extra`;
		assert.equal(long.length, FINGERPRINT_MAX_LENGTH + 5);
		assert.throws(() => parseFingerprint(long), /at most 36/);
	});

	it("surrounding whitespace is refused rather than trimmed", () => {
		// Trimming would make " <uuid> " and "<uuid>" one budget, which is two header
		// values addressing one allowance.
		//
		// Both forms are 37 characters, so they are caught by the length check before the
		// format check ever runs. The message therefore varies; what matters is that both
		// are refused and neither is repaired.
		for (const padded of [" 9f804ce6-e364-4363-aa5b-58c729c8d66f", "9f804ce6-e364-4363-aa5b-58c729c8d66f "]) {
			assert.equal(padded.length, FINGERPRINT_MAX_LENGTH + 1);
			assert.throws(() => parseFingerprint(padded), /fingerprint|at most/i);
		}
	});

	it("never returns a different string than it was given", () => {
		for (const uuid of UUIDS) {
			assert.equal(parseFingerprint(uuid), uuid);
		}
	});
});

describe("both layers use the one validator", () => {
	it("the kafelot pre-flight path does not read the header itself", () => {
		// It used to cast the header straight to string, which accepted anything and then
		// truncated to fit VARCHAR(64) -- so a caller could hold two budgets at once.
		assert.doesNotMatch(KAFELOT, /req\.headers\["x-kafelot-fingerprint"\] as string/);
		assert.match(KAFELOT, /parseFingerprint/);
	});

	it("the billing endpoint does not read the header itself", () => {
		assert.match(BILLING, /parseFingerprint/);
		assert.doesNotMatch(BILLING, /slice\(0, 64\)/);
		assert.doesNotMatch(BILLING, /slice\(0, FINGERPRINT_MAX_LENGTH\)/);
	});

	it("no layer truncates a fingerprint to fit a column", () => {
		for (const [name, src] of [["kafelot", KAFELOT], ["billing", BILLING]] as const) {
			assert.doesNotMatch(src, /fingerprint[^\n]*slice/, `${name} still slices a fingerprint`);
		}
	});
});
