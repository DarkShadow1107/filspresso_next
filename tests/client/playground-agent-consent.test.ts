import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentConsentQueue } from "../../src/lib/playgroundAgentConsent";
import type { AgentApproval } from "../../src/lib/playgroundAgentLoop";

const approval = (): AgentApproval => ({ id: crypto.randomUUID(), workspace: { id: crypto.randomUUID(), location: "hosted-docker" },
	call: { id: "call_1", name: "run_command", arguments: '{"command":"python3 main.py"}' }, effect: "execution" });

test("fresh consent waits for an explicit matching decision and consumes it once", async () => {
	const queue = new AgentConsentQueue(); const action = approval();
	const pending = queue.request(action, new AbortController().signal);
	assert.equal(queue.getSnapshot()?.id, action.id);
	assert.equal(queue.decide(crypto.randomUUID(), true), false); assert.notEqual(queue.getSnapshot(), null);
	assert.equal(queue.decide(action.id, true), true); assert.deepEqual(await pending, { approvalId: action.id, approved: true });
	assert.equal(queue.decide(action.id, true), false); assert.equal(queue.getSnapshot(), null);
	assert.equal((await queue.request(action, new AbortController().signal)).approved, false);
});

test("consent snapshot cannot change when the caller mutates its action", async () => {
	const queue = new AgentConsentQueue(); const action = approval(); const originalId = action.id; const cancellation = new AbortController();
	const pending = queue.request(action, cancellation.signal);
	action.call.arguments = '{"command":"different"}';
	Object.assign(action, { id: crypto.randomUUID() });
	assert.equal(queue.getSnapshot()?.id, originalId);
	assert.equal(queue.getSnapshot()?.call.arguments, '{"command":"python3 main.py"}');
	assert.throws(() => Object.assign(queue.getSnapshot()!.workspace, { id: crypto.randomUUID() }));
	cancellation.abort(); assert.equal((await pending).approved, false);
});

test("a second pending approval is denied without displacing the first", async () => {
	const queue = new AgentConsentQueue(); const first = approval(); const next = approval(); const pending = queue.request(first, new AbortController().signal);
	assert.equal((await queue.request(next, new AbortController().signal)).approved, false); assert.equal(queue.getSnapshot()?.id, first.id);
	queue.clear(); assert.equal((await pending).approved, false);
});

test("account/navigation cancellation denies consent and late clicks cannot approve a new action", async () => {
	const queue = new AgentConsentQueue(); const old = approval(); const cancellation = new AbortController();
	const previous = queue.request(old, cancellation.signal); cancellation.abort(); assert.equal((await previous).approved, false);
	const next = approval(); const current = queue.request(next, new AbortController().signal);
	assert.equal(queue.decide(old.id, true), false); assert.equal(queue.getSnapshot()?.id, next.id);
	queue.clear(); assert.equal((await current).approved, false);
});

test("already-cancelled requests never become pending and reentrant dismissal is safe", async () => {
	const queue = new AgentConsentQueue(); const cancellation = new AbortController(); cancellation.abort();
	assert.equal((await queue.request(approval(), cancellation.signal)).approved, false); assert.equal(queue.getSnapshot(), null);
	const unsubscribe = queue.subscribe(() => { if (queue.getSnapshot()) queue.clear(); });
	assert.equal((await queue.request(approval(), new AbortController().signal)).approved, false); unsubscribe();
});

test("invalid/read-only consent challenges cannot be turned into execution permission", async () => {
	const queue = new AgentConsentQueue();
	for (const patch of [{ effect: "read_only" }, { id: "recorded-approval" }, { workspace: { id: crypto.randomUUID(), location: "host" } }]) {
		assert.equal((await queue.request({ ...approval(), ...patch } as AgentApproval, new AbortController().signal)).approved, false);
		assert.equal(queue.getSnapshot(), null);
	}
});
