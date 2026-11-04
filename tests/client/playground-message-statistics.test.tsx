import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LlamaMessageStatistics from "../../src/components/playground/LlamaMessageStatistics";

test("statistics use llama.cpp's Lucide SVG icons and disclose wall-clock throughput", () => {
	const html = renderToStaticMarkup(<LlamaMessageStatistics model="Example" outputTokens={123} seconds={7.3} />);
	assert.match(html, /aria-label="Prompt tokens"/);
	assert.match(html, /aria-label="Generated tokens"/);
	assert.ok((html.match(/<svg/g) ?? []).length >= 5);
	assert.doesNotMatch(html, /[▤✧▱◷◴]/);
	assert.match(html, /Average over elapsed response time, not model decoding speed/);
});
