import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlaygroundSandboxController } from "../src/desktop/playground-sandbox.controller";
import type { PlaygroundSandboxService } from "../src/desktop/playground-sandbox.service";

test("manual sandbox writes require literal fresh client approval separately from commands/questions", async () => {
	const requests: unknown[][] = [];
	const service = { request: async (...args: unknown[]) => { requests.push(args); return { path: "a.txt", bytes: 1 }; } };
	const controller = new PlaygroundSandboxController(service as unknown as PlaygroundSandboxService);
	const req = { user: { id: 42 } }; const id = "00000000-0000-4000-8000-000000000042";
	for (const approved of [undefined, false, "true", 1])
		assert.throws(() => controller.write(req, id, { path: "a.txt", text: "x", approved }));
	assert.equal(requests.length, 0);
	await controller.write(req, id, { path: "a.txt", text: "x", approved: true });
	assert.deepEqual(requests[0], [42, "PUT", `/sandboxes/${id}/file`, { path: "a.txt", text: "x" }]);
});
