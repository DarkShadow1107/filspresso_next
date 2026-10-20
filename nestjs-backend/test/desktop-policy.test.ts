import "./test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopModelAccess } from "../src/desktop/desktop-policy";
import { DesktopGatewayService } from "../src/desktop/desktop-gateway.service";
import type { BillingService } from "../src/billing/billing.service";
import type { AddonsService } from "../src/billing/addons.service";
import type { Response } from "express";

const small = "lfm2_5_230m_q4_k_m";
const big = "lfm2_5_8b_a1b_q4_k_m";

/**
 * The per-model affordability rules, and the two properties that matter most.
 *
 * The first is that an add-on holder cannot spend their plan allowance on the Playground.
 * The subscription buys access, not usage, so the plan's monthly credit is not theirs to
 * spend here. A client that checked "does the account have allowance" alone would let
 * them start a generation that the charge then refuses.
 *
 * The second is that Max may run the 8B but not out of its allowance, so the 8B is
 * wallet-only on Max and allowance-covered on Ultimate.
 */
for (const scenario of [
	{ name: "no access is locked whatever the balance", tier: "free", source: null, wallet: true, model: small, generates: false, allowance: false },
	{ name: "an add-on holder cannot spend Kafelot credit", tier: "pro", source: "addon", wallet: false, model: small, generates: false, allowance: false },
	{ name: "a funded add-on holder can", tier: "pro", source: "addon", wallet: true, model: small, generates: true, allowance: false },
	{ name: "Max covers a small model from its allowance", tier: "max", source: "tier", wallet: false, model: small, generates: true, allowance: true },
	{ name: "Max cannot pay for the 8B from its allowance", tier: "max", source: "tier", wallet: false, model: big, generates: false, allowance: false },
	{ name: "Max can pay for the 8B from a funded wallet", tier: "max", source: "tier", wallet: true, model: big, generates: true, allowance: false },
	{ name: "Ultimate covers the 8B from its allowance", tier: "ultimate", source: "tier", wallet: false, model: big, generates: true, allowance: true },
] as const) {
	test(scenario.name, () => {
		const access = desktopModelAccess({
			modelKey: scenario.model,
			tier: scenario.tier,
			accessSource: scenario.source,
			walletCanGenerate: scenario.wallet,
			allowanceRemainingRon: 100,
		});
		assert.equal(access.canGenerate, scenario.generates);
		assert.equal(access.usesAllowance, scenario.allowance);
		assert.equal(access.locked, scenario.source === null);
	});
}

test("the gateway refuses wallet-only work before fetching an upstream", async () => {
	const billing = {
		getBalance: async () => ({ canGenerate: false }),
		getAllowance: async () => ({ remainingRon: 100 }),
	} as unknown as BillingService;
	const addons = {
		resolveSpectreAccess: async () => ({ hasAccess: true, source: "addon" }),
	} as unknown as AddonsService;

	const service = new DesktopGatewayService(billing, addons);
	const result = await service.streamChat({} as Response, 1, "pro", { model: small, message: "hi" });

	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.status, 402);
});

test("an unavailable entitlement store fails closed with 503", async () => {
	// Fail closed is the point: an unreachable store must not become a free generation.
	const addons = {
		resolveSpectreAccess: async () => {
			throw new Error("database unavailable");
		},
	} as unknown as AddonsService;

	const service = new DesktopGatewayService({} as BillingService, addons);
	const result = await service.streamChat({} as Response, 1, "max", { model: small, message: "hi" });

	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.status, 503);
});
