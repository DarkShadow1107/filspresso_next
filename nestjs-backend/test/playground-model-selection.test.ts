import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { DesktopController } from "../src/desktop/desktop.controller";
import { playgroundModelFile, playgroundModelKeys } from "../src/desktop/text-models";

const LEGACY = "lfm2_5_230m_q4_k_m";

test("the Playground model allowlist excludes LFM 2.5 while retaining its historical file mapping", () => {
	assert.equal(playgroundModelKeys().includes(LEGACY), false);
	assert.equal(playgroundModelFile(LEGACY), "LFM2.5-230M-Q4_K_M.gguf");
});

test("desktop entitlement prices LFM 2.5 historically without making it selectable", async () => {
	const controller = new DesktopController(
		{
			resolveTierFor: async () => "ultimate",
			getBalance: async () => ({ balanceRon: 20, canGenerate: true, minBalanceRon: 1, minBalanceIsCustom: false, autoRefill: {} }),
			getAllowance: async () => ({ grantedRon: 100, spentRon: 0, remainingRon: 100, resetAt: null }),
		} as never,
		{ resolveSpectreAccess: async () => ({ hasAccess: true, source: "tier", expiresAt: null, autoRenew: true, canFundWallet: true }) } as never,
		{} as never,
		{} as never,
		{} as never,
	);

	const result = await controller.entitlement({ user: { id: 42 } });
	const selectable = result.models as Array<{ modelKey: string }>;
	const historical = result.historicalModels as Array<{ modelKey: string; inputPer1M: number; outputPer1M: number }>;

	assert.ok(!selectable.some(model => model.modelKey === LEGACY));
	assert.deepEqual(
		[historical.find(model => model.modelKey === LEGACY)?.inputPer1M, historical.find(model => model.modelKey === LEGACY)?.outputPer1M],
		[0.3, 1.5],
	);
});
