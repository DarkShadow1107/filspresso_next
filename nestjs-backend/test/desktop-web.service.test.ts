import "./test-env";
import assert from "node:assert/strict";
import test from "node:test";
import * as http from "node:http";
import { BadRequestException } from "@nestjs/common";
import { assertPublicWebUrl, fetchPinnedPage, isPrivateAddress } from "../src/desktop/desktop-web.service";
import { lookup as dnsLookup } from "node:dns/promises";

test("public-page IP policy rejects loopback, private, link-local and reserved ranges", () => {
	for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
		assert.equal(isPrivateAddress(address), true, `${address} must not be fetched`);
	}
	for (const address of ["93.184.216.34", "8.8.8.8"]) assert.equal(isPrivateAddress(address), false);
});

test("public-page URL validation rejects local hosts, credentials, alternate ports and IPv6", async () => {
	for (const url of ["http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/latest/", "http://x.local/", "http://user:pass@example.com/", "http://example.com:8080/", "https://[2606:4700:4700::1111]/", "file:///etc/passwd"]) {
		await assert.rejects(assertPublicWebUrl(url), BadRequestException, url);
	}
	assert.deepEqual(await assertPublicWebUrl("https://93.184.216.34/path"), { hostname: "93.184.216.34", address: "93.184.216.34" });
});

test("DNS resolution rejects mixed public/private answers before opening a socket", async () => {
	const mixed = (async () => [
		{ address: "93.184.216.34", family: 4 as const }, { address: "127.0.0.1", family: 4 as const },
	]) as typeof dnsLookup;
	await assert.rejects(assertPublicWebUrl("https://rebinding.example/", mixed), BadRequestException);
});

test("HTTP requests use the already-pinned address while preserving the public Host header", async t => {
	let observedHost = "";
	const server = http.createServer((request, response) => {
		observedHost = String(request.headers.host || "");
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end("<title>Safe</title><p>page text</p>");
	});
	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
	const port = (server.address() as import("node:net").AddressInfo).port;
	const result = await fetchPinnedPage(`http://public.example:${port}/article`, "127.0.0.1");
	assert.equal(result.status, 200);
	assert.equal(result.body.toString("utf8"), "<title>Safe</title><p>page text</p>");
	assert.equal(observedHost, `public.example:${port}`);
});
