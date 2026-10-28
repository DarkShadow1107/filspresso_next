import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assessDesktopCompatibility, browserDesktopCompatibility } from "../../src/lib/desktopCompatibility";
import { DesktopCompatibilityDetails } from "../../src/components/playground/DesktopCompatibilityDialog";
import DesktopAppDownload from "../../src/components/playground/DesktopAppDownload";

test("Windows hints never claim to verify edition, build, features or execution availability", () => {
	const result = assessDesktopCompatibility({ platform: "Windows", architecture: "x86", bitness: "64", userAgent: "Windows NT 10.0; Win64; x64" });
	assert.equal(result.platform, "windows"); assert.equal(result.architecture, "x64"); assert.equal(result.status, "unverified");
	assert.match(result.message, /compatibility is not verified/);
});

test("high-entropy platform hints identify OS family, never the Windows build or Sandbox readiness", async () => {
	const requested: string[][] = [];
	const browser = { userAgent: "Windows NT 10.0", userAgentData: { platform: "Windows",
		getHighEntropyValues: async (keys: string[]) => { requested.push(keys); return { platformVersion: "19.0.0", architecture: "x86", bitness: "64" }; } } };
	const result = await browserDesktopCompatibility(browser as unknown as Navigator);
	assert.equal(result.osFamily, "Windows 11 or newer");
	assert.equal(result.architecture, "x64");
	assert.equal(result.status, "unverified");
	assert.ok(requested[0].includes("platformVersion"));
	assert.ok(!Number.isNaN(Date.parse(result.checkedAt)));
	assert.equal(assessDesktopCompatibility({ platform: "Windows", platformVersion: "10.0.0" }).osFamily, "Windows 10");
	assert.equal(assessDesktopCompatibility({ platform: "Windows", platformVersion: "garbled" }).osFamily, "Windows");
});

test("known non-Windows, mobile, old Windows and unqualified architecture warn rather than pass", () => {
	for (const hints of [{ platform: "Linux" }, { userAgent: "Macintosh; Intel Mac OS X" }, { platform: "Windows", mobile: true },
		{ userAgent: "Windows NT 6.1; Win64; x64" }, { platform: "Windows", architecture: "arm", bitness: "64" }, { platform: "Windows", bitness: "32" }]) {
		const result = assessDesktopCompatibility(hints); assert.equal(result.status, "unsupported");
		assert.match(result.message, /non-Windows|older Windows|may not match/);
	}
});

test("missing and redacted hints remain unknown, never silently supported", async () => {
	const result = await browserDesktopCompatibility({ userAgent: "" } as Navigator);
	assert.equal(result.platform, "unknown"); assert.equal(result.architecture, "unknown"); assert.equal(result.status, "unverified");
	assert.match(result.message, /could not be identified/);
});

test("denied browser hint APIs fall back to low-entropy information", async () => {
	const browser = { userAgent: "Windows NT 10.0", userAgentData: { platform: "Windows", getHighEntropyValues: async () => { throw new Error("Denied"); } } };
	const result = await browserDesktopCompatibility(browser as unknown as Navigator);
	assert.equal(result.platform, "windows"); assert.equal(result.architecture, "unknown"); assert.equal(result.status, "unverified");
});

test("a hanging hint API is bounded so the popup does not trap the download indefinitely", async () => {
	const result = await browserDesktopCompatibility({ userAgent: "Windows NT 10.0", userAgentData: { platform: "Windows", getHighEntropyValues: () => new Promise(() => {}) } } as unknown as Navigator);
	assert.equal(result.status, "unverified"); assert.equal(result.platform, "windows");
});

test("popup explains Home fallback, shared-kernel limitations and authoritative desktop checks", () => {
	const html = renderToStaticMarkup(<DesktopCompatibilityDetails result={assessDesktopCompatibility({ platform: "Linux" })} />);
	for (const text of ["role=\"alert\"", "Windows x64", "Home is supported", "shares the host kernel", "cannot verify", "authoritative checks", "not unlock every feature", "Command networking"]) assert.ok(html.includes(text), text);
	assert.ok(!html.includes("href=\"/api/desktop/download"));
});

test("download starts disabled before authenticated package metadata and never downloads on render", () => {
	const html = renderToStaticMarkup(<DesktopAppDownload />);
	assert.match(html, /disabled=""/); assert.match(html, /Download Desktop App/);
	assert.ok(!html.includes("<dialog")); assert.ok(!html.includes("href="));
});
