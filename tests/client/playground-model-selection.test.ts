import assert from "node:assert/strict";
import test from "node:test";
import {
	PLAYGROUND_MODEL_KEYS,
	PLAYGROUND_SELECTABLE_MODEL_KEYS,
	PLAYGROUND_SELECTABLE_TEXT_MODEL_KEYS,
	TEXT_MODEL_1_7B,
	TEXT_MODEL_230M,
	isPlaygroundModelKey,
	isSelectablePlaygroundModelKey,
} from "../../src/lib/modelAccess";

test("LFM 2.5 stays known for history and API rates, but cannot be selected for a new Playground turn", () => {
	assert.equal(isPlaygroundModelKey(TEXT_MODEL_230M), true);
	assert.equal(isSelectablePlaygroundModelKey(TEXT_MODEL_230M), false);
	assert.ok(PLAYGROUND_MODEL_KEYS.includes(TEXT_MODEL_230M));
	assert.ok(!PLAYGROUND_SELECTABLE_MODEL_KEYS.includes(TEXT_MODEL_230M));
	assert.deepEqual(PLAYGROUND_SELECTABLE_TEXT_MODEL_KEYS, [TEXT_MODEL_1_7B]);
});

test("every selectable Playground model is still a known model", () => {
	for (const model of PLAYGROUND_SELECTABLE_MODEL_KEYS) {
		assert.ok(isPlaygroundModelKey(model), model);
		assert.ok(isSelectablePlaygroundModelKey(model), model);
	}
});
