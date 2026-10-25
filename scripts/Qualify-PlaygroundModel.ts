/** Explicit operator probes against the real authenticated metered gateway.
 * No executor, approval endpoint, automatic retries, allowlist edits or token logging. */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseNativeAgentReply, readAgentJson, type NativeAgentRequest } from "../src/lib/playgroundAgent";

async function main() {
	const [baseArg, model, output] = process.argv.slice(2);
	if (!baseArg || !model || !output || !process.env.PLAYGROUND_QUALIFICATION_TOKEN || !stdin.isTTY)
		throw new Error("Usage: tsx scripts/Qualify-PlaygroundModel.ts <https://gateway> <model-key> <new-evidence.json>. Set PLAYGROUND_QUALIFICATION_TOKEN; interactive per-request confirmation is mandatory.");
	const base = new URL(baseArg);
	if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Use an HTTPS gateway origin without embedded credentials.");
	const headers = { Authorization: `Bearer ${process.env.PLAYGROUND_QUALIFICATION_TOKEN}`, "Content-Type": "application/json" };
	const endpoint = new URL("/api/desktop/agent/", base);
	const capabilities = await readAgentJson(new URL("capabilities", endpoint).href, { method: "GET", headers }, undefined, 8000);
	if (capabilities.protocol !== "native-v1" || capabilities.conversationProtocol !== "completed-turns-v1" || !Array.isArray(capabilities.models) || !capabilities.models.includes(model))
		throw new Error("Model/conversation is not operator-allowlisted on the live gateway. No billable request sent.");
	const nonce = randomBytes(12).toString("hex");
	const request: NativeAgentRequest = { version: 1, model, mode: "plan", temperature: 0, max_tokens: 512, input_context_tokens: 16384,
		system_prompt: "Follow the user's probe exactly. Use the native tool protocol, not textual pseudo-calls. Only one tool call is needed. After its result, reply with the nonce and no further calls.",
		message: `Call qualification_echo exactly once with nonce ${nonce}. When its result arrives, reply with that nonce and do not call another tool.`,
		tools: [{ name: "qualification_echo", effect: "read_only", description: "Inert qualification echo, no execution authority.", parameters: { type: "object", additionalProperties: false, properties: { nonce: { type: "string", minLength: 24, maxLength: 24 } }, required: ["nonce"] } }], history: [] };
	const prompt = createInterface({ input: stdin, output: stdout });
	try {
		const send = async (number: number) => {
			if ((await prompt.question(`Send live billable probe ${number}/2 for ${model}, max 512 output tokens? Type SEND: `)).trim() !== "SEND") throw new Error("Cancelled; no further request sent.");
			return parseNativeAgentReply(await readAgentJson(new URL("turn", endpoint).href, { method: "POST", headers, body: JSON.stringify(request) }, undefined, 130000), request);
		};
		const first = await send(1);
		if (first.tool_calls.length !== 1 || first.tool_calls[0].name !== "qualification_echo" || JSON.parse(first.tool_calls[0].arguments).nonce !== nonce) throw new Error("Native call probe failed; no retry or execution attempted.");
		request.history = [{ text: first.text, tool_calls: first.tool_calls, tool_results: [{ tool_call_id: first.tool_calls[0].id, content: `Qualification-only fixture echo: ${nonce}. No file or command executed.` }] }];
		const second = await send(2);
		if (second.tool_calls.length !== 0 || !second.text.includes(nonce) || first.runId === second.runId) throw new Error("Paired follow-up probe failed; no retry attempted.");
		await writeFile(output, JSON.stringify({ version: 1, observedUtc: new Date().toISOString(), gateway: base.origin, model,
			checks: ["live-native-call", "paired-follow-up", "distinct-metered-response-receipts"],
			runs: [first, second].map(reply => ({ runId: reply.runId, usage: reply.usage, settlement: reply.settlement })),
			limits: "Not full model qualification: wallet/ledger reconciliation, cancellation, compaction, all templates and production execution still require operator verification. No executor was invoked." }, null, 2), { flag: "wx" });
		console.log("Live native/metered-response probes passed; evidence written. Reconcile the recorded run IDs with the real billing ledger. This does not enable an execution allowlist.");
	} finally { prompt.close(); }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Qualification failed."); process.exitCode = 1; });
