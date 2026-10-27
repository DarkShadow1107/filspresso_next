import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const route = readFileSync(
	path.resolve(process.cwd(), "src/app/api/desktop/download/route.ts"),
	"utf8",
);

test("successful MSI responses are private and not cacheable", () => {
	assert.match(route, /responseHeaders\.set\("Cache-Control", "private, no-store"\)/);
});

test("download refusals and upstream failures are private and not cacheable", () => {
	assert.match(
		route,
		/headers:\s*\{\s*"Content-Type": "application\/json", "Cache-Control": "private, no-store"\s*\}/,
	);
});
