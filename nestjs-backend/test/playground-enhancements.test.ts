import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { BillingService } from "../src/billing/billing.service";
import type { AddonsService } from "../src/billing/addons.service";
import type { Response as ExpressResponse } from "express";
import { PlaygroundController } from "../src/desktop/playground.controller";
import { DesktopGatewayService } from "../src/desktop/desktop-gateway.service";
import { readInputContext } from "../src/desktop/input-context";
import { fetchBounded, UpstreamTooLargeError } from "../src/common/utils/httpClient";

test("all three compaction modes are accepted; balanced is the shared default", () => {
	assert.equal(readInputContext({}).compaction_mode, "balanced");
	for (const mode of ["permissive", "balanced", "aggressive"]) assert.equal(readInputContext({ compaction_mode: mode }).compaction_mode, mode);
	for (const mode of ["off", "proactive", "constructor", 0]) assert.throws(() => readInputContext({ compaction_mode: mode }));
});

for (const scenario of [{ tier: "pro", source: "addon", model: "lfm2_5_230m_q4_k_m" }, { tier: "max", source: "tier", model: "lfm2_5_8b_a1b_q4_k_m" }]) {
	test(`web model loading refuses ${scenario.tier}/${scenario.model} without wallet funds`, async () => {
		const billing = { resolveTierFor: async () => scenario.tier, getBalance: async () => ({ canGenerate: false }), getAllowance: async () => ({ remainingRon: 100 }) } as unknown as BillingService;
		const addons = { resolveSpectreAccess: async () => ({ hasAccess: true, source: scenario.source }) } as unknown as AddonsService;
		const controller = new PlaygroundController(billing, addons, {} as DesktopGatewayService);
		await assert.rejects(controller.load({ user: { id: 42 } }, { model: scenario.model }), (error: { getStatus(): number }) => error.getStatus() === 402);
	});
}

test("web requests use the backend gateway and its playground settlement scope", async () => {
	let actualScope: unknown;
	const gateway = { streamChat: async (_res: unknown, account: number, tier: string, body: unknown, scope: string) => {
		assert.equal(account, 42); assert.equal(tier, "max"); actualScope = scope; return { kind: "sent", requestId: "server-id" };
	} } as unknown as DesktopGatewayService;
	const controller = new PlaygroundController({ resolveTierFor: async () => "max" } as unknown as BillingService, {} as AddonsService, gateway);
	await controller.chat({ user: { id: 42 } }, {} as ExpressResponse, { model: "lfm2_5_230m_q4_k_m", message: "hello" });
	assert.equal(actualScope, "playground");
});

test("authorized warmup carries the internal service credential", async () => {
	const previousFetch = globalThis.fetch;
	const previousKey = process.env.AI_SERVICE_KEY;
	process.env.AI_SERVICE_KEY = "unit-test-service-key";
	globalThis.fetch = async (_url, init) => {
		assert.equal(new Headers(init?.headers).get("x-ai-service-key"), "unit-test-service-key");
		return Response.json({ status: "warming" });
	};
	try {
		const billing = { resolveTierFor: async () => "max", getBalance: async () => ({ canGenerate: true }), getAllowance: async () => ({ remainingRon: 10 }) } as unknown as BillingService;
		const addons = { resolveSpectreAccess: async () => ({ hasAccess: true, source: "tier" }) } as unknown as AddonsService;
		assert.deepEqual(await new PlaygroundController(billing, addons, {} as DesktopGatewayService).load({ user: { id: 42 } }, { model: "lfm2_5_230m_q4_k_m" }), { status: "warming" });
	} finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.AI_SERVICE_KEY; else process.env.AI_SERVICE_KEY = previousKey; }
});

class Reply extends EventEmitter {
	body = "";
	destroyed = false;
	headersSent = false;
	status() { return this; }
	setHeader() { return this; }
	flushHeaders() { this.headersSent = true; }
	write(value: string) { this.body += value; return true; }
	end() {}
}

function fundedGateway(charges: Array<Record<string, unknown>>) {
	const billing = { getBalance: async () => ({ canGenerate: true }), getAllowance: async () => ({ remainingRon: 100 }), recordUsage: async (value: Record<string, unknown>) => { charges.push(value); } } as unknown as BillingService;
	const addons = { resolveSpectreAccess: async () => ({ hasAccess: true, source: "tier" }) } as unknown as AddonsService;
	return new DesktopGatewayService(billing, addons);
}

test("summary and answer usage settle once with distinct server IDs before completion is forwarded", async () => {
	const charges: Array<Record<string, unknown>> = [];
	const previousFetch = globalThis.fetch;
	const frames = [{ context: { compacted: true, usage: { prompt_tokens: 20, completion_tokens: 5 } } }, { delta: "answer" }, { done: true, usage: { prompt_tokens: 10, completion_tokens: 2 } }, { done: true, usage: { prompt_tokens: 10, completion_tokens: 2 } }];
	globalThis.fetch = async () => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
	try {
		const res = new Reply();
		const originalWrite = res.write.bind(res);
		res.write = value => { if (value.includes('"done":true')) assert.equal(charges.length, 2); return originalWrite(value); };
		assert.equal((await fundedGateway(charges).streamChat(res as unknown as ExpressResponse, 42, "max", { model: "lfm2_5_230m_q4_k_m", message: "hello" }, "playground")).kind, "sent");
		assert.equal(charges.length, 2);
		assert.ok(String(charges[0].requestId).endsWith("-compaction"));
		assert.equal(charges[1].scope, "playground");
		assert.notEqual(charges[0].requestId, charges[1].requestId);
	} finally { globalThis.fetch = previousFetch; }
});

test("a compaction that consumes tokens but cannot fit still settles only that work", async () => {
	const charges: Array<Record<string, unknown>> = [];
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async () => Response.json({ error: "INPUT_CONTEXT_EXCEEDED", message: "History preserved", compaction_usage: { prompt_tokens: 20, completion_tokens: 5 } }, { status: 413 });
	try {
		const result = await fundedGateway(charges).streamChat(new Reply() as unknown as ExpressResponse, 42, "max", { model: "lfm2_5_230m_q4_k_m", message: "hello" }, "playground");
		assert.equal(result.kind, "refused");
		assert.equal(charges.length, 1);
		assert.ok(String(charges[0].requestId).endsWith("-compaction"));
	} finally { globalThis.fetch = previousFetch; }
});

test("bounded HTTP checks actual bytes even when content-length understates the body", async () => {
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response("more than two bytes", { headers: { "content-length": "1" } });
	try { await assert.rejects(fetchBounded("http://test", { maxBytes: 2 }), UpstreamTooLargeError); }
	finally { globalThis.fetch = previousFetch; }
});
