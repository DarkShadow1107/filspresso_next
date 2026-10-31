import assert from "node:assert/strict";
import { test } from "node:test";
import { displayToolText } from "../../src/lib/playgroundToolText";

test("LFM tool-like text is labelled, never treated as execution", () => {
	const result = displayToolText('Before <|tool_call_start|>[GetDocumentInfo(productName="Polo 9n")]<|tool_call_end|> after');
	assert.deepEqual(result, { text: "Before  after", names: ["GetDocumentInfo"] });
	assert.deepEqual(displayToolText("ordinary text"), { text: "ordinary text", names: [] });
	assert.deepEqual(displayToolText("answer <|tool_call_sta", true), { text: "answer ", names: [] });
	assert.deepEqual(displayToolText("answer <|tool_call_start|>[Search(q=", true), { text: "answer ", names: [] });
	assert.deepEqual(displayToolText("answer <|tool_call_start|>[Search(q="), { text: "answer ", names: ["Search"] });
});
