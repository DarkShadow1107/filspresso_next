import assert from "node:assert/strict";
import { test } from "node:test";
import { explicitlyRequestsWebSearch } from "../../src/lib/playgroundToolIntent";

test("explicit web searches route to the agent without converting ordinary chat", () => {
	assert.equal(explicitlyRequestsWebSearch("search the web for it"), true);
	assert.equal(explicitlyRequestsWebSearch("look up the current price online"), true);
	assert.equal(explicitlyRequestsWebSearch("What day is it?"), false);
});
