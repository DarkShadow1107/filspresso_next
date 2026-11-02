import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { PlaygroundSandboxController } from "../src/desktop/playground-sandbox.controller";
import type { PlaygroundSandboxService } from "../src/desktop/playground-sandbox.service";

test("the authenticated web sandbox command route is refused without calling the broker", () => {
	let called = false;
	const service = { run: () => { called = true; } } as unknown as PlaygroundSandboxService;
	const controller = new PlaygroundSandboxController(service);
	assert.throws(() => controller.run(), (error: unknown) => {
		assert.ok(error instanceof ForbiddenException);
		assert.deepEqual(error.getResponse(), { error: "WEB_COMMAND_EXECUTION_DISABLED", message: "Running code or commands is not available in the web Playground." });
		return true;
	});
	assert.equal(called, false);
});
