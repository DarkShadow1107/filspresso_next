import assert from "node:assert/strict";
import { test } from "node:test";
import { generateMetadata } from "../../src/app/page";

test("Next page metadata awaits async search parameters without changing slug normalization", async () => {
	assert.equal((await generateMetadata({})).title, "Filspresso");
	for (const [page, title] of [["playground", "Filspresso - Playground"], [" coffee ", "Filspresso - Coffee"], [["playground", "coffee"], "Filspresso - Playground"], ["unavailable", "Filspresso"]] as const)
		assert.equal((await generateMetadata({ searchParams: Promise.resolve({ page: Array.isArray(page) ? [...page] : page as string }) })).title, title);
});
