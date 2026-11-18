import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LlamaToolActivity from "../../src/components/playground/LlamaToolActivity";

test("tool activity uses a llama.cpp-style collapsible summary and readable result", () => {
	const html = renderToStaticMarkup(<LlamaToolActivity tool={{
		id: "call-1", name: "read_file", arguments: "{\"path\":\"src/app.ts\"}",
		status: "finished", result: "{\"ok\":true}",
	}} />);
	assert.match(html, /<details class="pgw-tool-activity">/);
	assert.match(html, /Read File/);
	assert.match(html, /Finished/);
	assert.match(html, /Arguments/);
	assert.match(html, /Result/);
	assert.match(html, /&quot;ok&quot;:\s+true/);
});

test("unexecuted tool proposals are labeled rather than presented as completed actions", () => {
	const html = renderToStaticMarkup(<LlamaToolActivity tool={{
		id: "call-2", name: "write_file", arguments: "{\"path\":\"notes.txt\"}",
		status: "proposed",
	}} />);
	assert.match(html, /Proposed · not run/);
	assert.match(html, /This proposal was not executed/);
});
