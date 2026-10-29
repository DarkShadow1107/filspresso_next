import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as acknowledge } from "../../src/app/api/desktop/installer/ack/route";
import { GET as installations } from "../../src/app/api/desktop/installations/route";

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

test("desktop web proxies forward the session, exact body and CSRF headers; never replay acknowledgements", async () => {
	const original = globalThis.fetch;
	const calls: { url: string; init?: RequestInit }[] = [];
	try {
		globalThis.fetch = async (url, init) => {
			calls.push({ url: String(url), init });
			return Response.json({ acknowledged: true, productVersion: "0.3.2" });
		};
		const body = JSON.stringify({ productVersion: "0.3.2", operatingSystem: "Windows 11 24H2 or newer" });
		const response = await acknowledge(new NextRequest("https://localhost:8443/api/desktop/installer/ack", {
			method: "POST", body, headers: { "content-type": "application/json", cookie: "filspresso_session=fixture; admin_session=never-forward",
				origin: "https://localhost:8443", "sec-fetch-site": "same-origin" },
		}));
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "private, no-store");
		assert.equal(calls.length, 1);
		assert.ok(calls[0].url.endsWith("/api/desktop/installer/ack"));
		const headers = new Headers(calls[0].init?.headers);
		assert.equal(headers.get("cookie"), "filspresso_session=fixture");
		assert.equal(headers.get("origin"), "https://localhost:8443");
		assert.equal(headers.get("sec-fetch-site"), "same-origin");
		assert.equal(Buffer.from(calls[0].init?.body as ArrayBuffer).toString(), body);
		for (const status of [401, 403, 409]) {
			globalThis.fetch = async () => Response.json({ error: "REFUSED" }, { status });
			assert.equal((await acknowledge(new NextRequest("https://localhost/api/desktop/installer/ack", { method: "POST", body }))).status, status);
		}
		let attempts = 0;
		globalThis.fetch = async () => { attempts++; throw new Error("ambiguous network failure"); };
		assert.equal((await acknowledge(new NextRequest("https://localhost/api/desktop/installer/ack", { method: "POST", body }))).status, 503);
		assert.equal(attempts, 1);
		globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ acknowledgements: [], installations: [] }); };
		const result = await installations(new NextRequest("https://localhost/api/desktop/installations", { headers: { authorization: "Bearer fixture" } }));
		assert.equal(result.status, 200);
		assert.equal(result.headers.get("cache-control"), "private, no-store");
		assert.ok(calls.at(-1)!.url.endsWith("/api/desktop/installations"));
		assert.equal(new Headers(calls.at(-1)!.init?.headers).get("authorization"), "Bearer fixture");
		assert.deepEqual(await result.json(), { acknowledgements: [], installations: [] });
	} finally { globalThis.fetch = original; }
});
