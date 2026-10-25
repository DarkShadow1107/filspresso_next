import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { createRequestTimeoutMiddleware } from "../src/common/middleware/request-timeout.middleware";

test("media preparation survives the ordinary deadline while normal API calls still time out", async () => {
	const responses: Array<EventEmitter & { timedOut: boolean; headersSent: boolean; status: () => unknown; json: () => void }> = [];
	try {
		for (const path of ["/api/playground/context/file", "/api/playground/context/github", "/api/desktop/chat/stream", "/api/playground/agent/turn", "/api/desktop/agent/turn", "/api/orders"]) {
			const response = Object.assign(new EventEmitter(), { timedOut: false, headersSent: false, status() { return this; }, json() { this.timedOut = true; } });
			responses.push(response);
			createRequestTimeoutMiddleware(10)({ path } as Request, response as unknown as Response, () => {});
		}
		await new Promise((resolve) => setTimeout(resolve, 35));
		assert.deepEqual(responses.map((response) => response.timedOut), [false, false, false, false, false, true]);
	} finally { for (const response of responses) response.emit("close"); }
});
