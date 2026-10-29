import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PlaygroundHelp from "../../src/components/playground/PlaygroundHelp";
import WorkspacePicker from "../../src/components/playground/WorkspacePicker";

test("web instructions explain browser-specific capabilities without starting work", t => {
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("No automatic work"); });
	const html = renderToStaticMarkup(<PlaygroundHelp onClose={() => { calls++; }} onManual={() => { calls++; }} onPreview={() => { calls++; }} />);
	assert.equal(calls, 0);
	for (const phrase of ["Browser guide", "Using the web Playground", "No code runs on your computer", "clarification answers are never approval", "cannot read your Windows edition", "Advanced tools", "diagnostic, single model turn"]) assert.ok(html.includes(phrase), phrase);
});

test("compact pickers expose a menu without native select or decorative arrow", () => {
	const html = renderToStaticMarkup(<WorkspacePicker label="Input context" value="16384" icon={null} options={[{ key: "16384", label: "16K" }]} onChange={() => { throw new Error("No selection on render"); }} />);
	assert.match(html, /aria-haspopup="menu"/);
	assert.match(html, /aria-expanded="false"/);
	assert.doesNotMatch(html, /select|chevron|⌄/i);
	assert.match(html, /16K/);
});
