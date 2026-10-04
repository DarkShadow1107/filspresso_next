import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join(__dirname, "..", "src");
const LEGACY_DIR = join(SRC_DIR, "legacy");

test("legacy Express route delegation stays removed from the NestJS backend", () => {
	// src/legacy/ held the LEGACY_ROUTE_MOUNTS map plus the module that mounted
	// the remaining Express handlers. It was deleted in 615a690 once the last
	// delegations were lifted, so the whole directory must stay gone.
	assert.equal(
		existsSync(LEGACY_DIR),
		false,
		`src/legacy was resurrected at ${LEGACY_DIR}; legacy route mounts must not be reintroduced`,
	);
});

test("no backend module references the deleted legacy route map", () => {
	// A stale `legacy-routes` import or mount would throw at bootstrap now that
	// the module is gone, so catch the reference in static source instead.
	const offenders: string[] = [];

	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (!entry.name.endsWith(".ts")) continue;

			const source = readFileSync(full, "utf8");
			if (source.includes("legacy-routes") || source.includes("LEGACY_ROUTE_MOUNTS")) {
				offenders.push(full.slice(SRC_DIR.length + 1));
			}
		}
	};

	walk(SRC_DIR);
	assert.deepEqual(
		offenders,
		[],
		`references to the removed legacy route map remain in: ${offenders.join(", ")}`,
	);
});