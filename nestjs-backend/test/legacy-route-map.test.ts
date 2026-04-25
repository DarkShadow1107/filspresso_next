import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_ROUTE_MOUNTS } from "../src/legacy/legacy-routes";

test("does not mount legacy runtime routes in the active NestJS backend", () => {
	assert.deepEqual(LEGACY_ROUTE_MOUNTS, []);
});
