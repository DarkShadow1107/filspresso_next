import { parseQuestionForm } from "../../nestjs-backend/src/desktop/playground-question-contract";
/** Native model proposals only. This module has no executor or approval authority. */
export type NativeTool = { name: string; description: string; effect: "read_only" | "mutation" | "execution" | "interaction"; parameters: Record<string, unknown> };
export type NativeCall = { id: string; name: string; arguments: string };
export type NativeHistoryGroup = { text: string; tool_calls: NativeCall[]; tool_results: Array<{ tool_call_id: string; content: string }> };
export type NativeConversationTurn = { message: string; text: string; history: NativeHistoryGroup[] };
export type NativeAgentRequest = {
	version: 1; model: string; mode: "plan" | "build"; message: string; system_prompt?: string;
	temperature: number; max_tokens: number; input_context_tokens: 16384 | 32768 | 65536 | 131072; tools: NativeTool[];
	history: NativeHistoryGroup[]; conversation?: NativeConversationTurn[]; session_uuid?: string;
	compaction_mode?: "permissive" | "balanced" | "aggressive";
};
export type NativeActionTicket = { tool_call_id: string; token: string; expires_at: number };
export type NativeAgentCompaction = { mode: "permissive" | "balanced" | "aggressive"; inputLimit: number; tokensBefore: number; tokensAfter: number;
	compacted: boolean; consumedGroups: number; summary?: string; usage: { prompt_tokens: number; completion_tokens: number } | null };
export type NativeAgentReply = { version: 1; runId: string; settlement: "succeeded"; text: string; finish_reason: "stop" | "tool_calls"; tool_calls: NativeCall[]; usage: { prompt_tokens: number; completion_tokens: number }; action_tickets?: NativeActionTicket[]; compaction?: NativeAgentCompaction };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const CALL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 1_048_576;

export async function readAgentJson(url: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number, requireVersion = true): Promise<Record<string, unknown>> {
	const deadline = AbortSignal.timeout(timeoutMs);
	const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
	const response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: combined });
	if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new Error(response.status === 401 ? "Sign in to use native agent transport." : "Native agent transport refused this turn. No automatic retry was attempted."); }
	if (!response.body || Number(response.headers.get("content-length")) > MAX_BYTES) { void response.body?.cancel().catch(() => undefined); throw new Error("Invalid native agent response."); }
	const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
	let abort!: () => void;
	const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new DOMException("Agent request cancelled", "AbortError")); combined.addEventListener("abort", abort, { once: true }); if (combined.aborted) abort(); });
	try {
		for (;;) { const { value, done } = await Promise.race([reader.read(), cancelled]); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error("Native agent response exceeds its byte limit."); chunks.push(value); }
	} finally { combined.removeEventListener("abort", abort); void reader.cancel().catch(() => undefined); try { reader.releaseLock(); } catch { /* Cancelled read may still be settling. */ } }
	const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	if (!object(body) || (requireVersion && body.version !== 1)) throw new Error("Unsupported native agent response format.");
	return body;
}

export async function nativeAgentModels(signal?: AbortSignal): Promise<string[]> {
	const body = await readAgentJson("/api/playground/agent/capabilities", { method: "GET" }, signal, 8_000);
	if (body.protocol !== "native-v1" || body.executesTools !== false || !Array.isArray(body.models) || body.models.length > 6 || body.models.some(model => typeof model !== "string" || !model || model.length > 64) || new Set(body.models).size !== body.models.length)
		throw new Error("Invalid native agent capabilities.");
	return body.models as string[];
}

/** Conversation clients require explicit support; an older proposal-only server is not upgraded by a UI claim. */
export async function nativeConversationModels(signal?: AbortSignal): Promise<string[]> {
	const body = await readAgentJson("/api/playground/agent/capabilities", { method: "GET" }, signal, 8_000);
	if (body.protocol !== "native-v1" || body.executesTools !== false || body.conversationProtocol !== "completed-turns-v1" ||
		!Array.isArray(body.interactionProtocols) || !body.interactionProtocols.includes("question-v1") || !Array.isArray(body.models) || body.models.length > 6 ||
		body.models.some(model => typeof model !== "string" || !model || model.length > 64) || new Set(body.models).size !== body.models.length) throw new Error("Native conversation/question protocol is unavailable.");
	return body.models as string[];
}

export function parseNativeAgentReply(body: Record<string, unknown>, request: NativeAgentRequest): NativeAgentReply {
	if (body.version !== 1 || typeof body.runId !== "string" || !/^dsk-[0-9a-f]{24}$/.test(body.runId) || body.settlement !== "succeeded" || typeof body.text !== "string" || body.text.length > 32_768 ||
		!object(body.usage) || !Number.isInteger(body.usage.prompt_tokens) || Number(body.usage.prompt_tokens) < 0 || Number(body.usage.prompt_tokens) > 2_147_483_647 || !Number.isInteger(body.usage.completion_tokens) || Number(body.usage.completion_tokens) < 0 ||
		Number(body.usage.completion_tokens) > request.max_tokens || Number(body.usage.prompt_tokens) + Number(body.usage.completion_tokens) === 0 || !Array.isArray(body.tool_calls) || body.tool_calls.length > 8 ||
		!((body.finish_reason === "stop" && body.tool_calls.length === 0) || (body.finish_reason === "tool_calls" && body.tool_calls.length > 0))) throw new Error("Invalid, unmetered or unsettled native agent response.");
	const names = new Set(request.tools.map(tool => tool.name)); const ids = new Set([...(request.conversation ?? []).flatMap(turn => turn.history.flatMap(group => group.tool_calls.map(call => call.id))), ...request.history.flatMap(group => group.tool_calls.map(call => call.id))]);
	const calls = body.tool_calls.map(call => {
		if (!object(call) || typeof call.id !== "string" || !CALL_ID.test(call.id) || ids.has(call.id) || typeof call.name !== "string" || !names.has(call.name) || typeof call.arguments !== "string" || new TextEncoder().encode(call.arguments).length > 16_384)
			throw new Error("Invalid native tool proposal.");
		if (call.name === "question") parseQuestionForm(call.arguments);
		else validateArguments(call.arguments, request.tools.find(tool => tool.name === call.name)!.parameters);
		ids.add(call.id);
		return { id: call.id, name: call.name, arguments: call.arguments };
	});
	if (calls.some(call => call.name === "question") && calls.length !== 1) throw new Error("Clarification must finish before the model can propose subsequent actions.");
	if (ids.size > 48) throw new Error("Native tool proposal limit exceeded.");
	let compaction: NativeAgentCompaction | undefined;
	if (body.compaction !== undefined) {
		const value = body.compaction;
		const count = (number: unknown) => Number.isInteger(number) && Number(number) >= 0 && Number(number) <= 2_147_483_647;
		if (!object(value) || value.mode !== (request.compaction_mode ?? "balanced") || value.inputLimit !== request.input_context_tokens ||
			!count(value.tokensBefore) || !count(value.tokensAfter) || typeof value.compacted !== "boolean") throw new Error("Invalid agent context measurement.");
		if (value.compacted) {
			const fraction = { permissive: .8, balanced: .65, aggressive: .45 }[value.mode as NativeAgentCompaction["mode"]];
			if (!Number.isInteger(value.consumedGroups) || Number(value.consumedGroups) < 1 || Number(value.consumedGroups) >= request.history.length + (request.conversation?.length ?? 0) ||
				typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 32_000 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value.summary) ||
				Number(value.tokensAfter) >= Number(value.tokensBefore) || Number(value.tokensAfter) >= Math.min(Math.floor(request.input_context_tokens * fraction), 131_072 - request.max_tokens - 256) ||
				!object(value.usage) || !count(value.usage.prompt_tokens) || !count(value.usage.completion_tokens) || Number(value.usage.prompt_tokens) + Number(value.usage.completion_tokens) === 0 ||
				Number(value.usage.prompt_tokens) > Number(body.usage.prompt_tokens) || Number(value.usage.completion_tokens) > Math.min(2048, Math.floor(request.max_tokens / 4), Number(body.usage.completion_tokens))) throw new Error("Invalid agent compaction receipt.");
		} else if (value.consumedGroups !== 0 || value.tokensBefore !== value.tokensAfter || value.summary !== undefined || value.usage !== null) throw new Error("Invalid agent context measurement.");
		compaction = value as NativeAgentCompaction;
	}
	let tickets: NativeActionTicket[] | undefined;
	if (body.action_tickets !== undefined) {
		const seen = new Set<string>();
		if (!Array.isArray(body.action_tickets) || body.action_tickets.length > calls.length) throw new Error("Invalid native action tickets.");
		tickets = body.action_tickets.map(ticket => {
			if (!object(ticket) || typeof ticket.tool_call_id !== "string" || !calls.some(call => call.id === ticket.tool_call_id) || seen.has(ticket.tool_call_id) ||
				typeof ticket.token !== "string" || ticket.token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(ticket.token) || !Number.isSafeInteger(ticket.expires_at) || Number(ticket.expires_at) <= 0) throw new Error("Invalid native action ticket.");
			seen.add(ticket.tool_call_id); return { tool_call_id: ticket.tool_call_id, token: ticket.token, expires_at: Number(ticket.expires_at) };
		});
	}
	return { version: 1, runId: body.runId, settlement: "succeeded", text: body.text, finish_reason: body.finish_reason as NativeAgentReply["finish_reason"], tool_calls: calls,
		usage: { prompt_tokens: Number(body.usage.prompt_tokens), completion_tokens: Number(body.usage.completion_tokens) }, ...(tickets ? { action_tickets: tickets } : {}), ...(compaction ? { compaction } : {}) };
}

/** Same closed scalar argument subset as the server; duplicate JSON keys are not collapsed. */
function validateArguments(raw: string, schema: Record<string, unknown>) {
	const fail = () => { throw new Error("Native tool arguments do not match their schema."); };
	let index = 0; const seen = new Set<string>();
	const skip = () => { while (/[ \t\r\n]/.test(raw[index] ?? "") && index < raw.length) index++; };
	const token = () => { const match = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(raw.slice(index)); if (!match) return fail(); index += match[0].length; return JSON.parse(match[0]) as string; };
	const args: Record<string, unknown> = Object.create(null);
	skip(); if (raw[index++] !== "{") fail(); skip();
	if (raw[index] !== "}") for (;;) {
		const key = token(); if (seen.has(key)) fail(); seen.add(key); skip(); if (raw[index++] !== ":") fail(); skip();
		if (raw[index] === '"') args[key] = token();
		else { const value = /^(?:true|false|-?(?:0|[1-9]\d*))(?=[ \t\r\n]*[,}])/.exec(raw.slice(index)); if (!value) return fail(); index += value[0].length; args[key] = JSON.parse(value[0]); }
		skip(); if (raw[index] === "}") break; if (raw[index++] !== ",") fail(); skip();
	}
	if (raw[index++] !== "}") fail(); skip(); if (index !== raw.length || !object(schema.properties) || !Array.isArray(schema.required) || schema.required.some(key => typeof key !== "string" || !seen.has(key))) fail();
	const fields = schema.properties as Record<string, unknown>;
	for (const [key, value] of Object.entries(args)) {
		const field = Object.hasOwn(fields, key) ? fields[key] : null; if (!object(field)) return fail();
		if (field.type === "string") { if (typeof value !== "string" || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) || Array.from(value).length < Number(field.minLength) || Array.from(value).length > Number(field.maxLength)) fail(); }
		else if (field.type === "integer") { if (typeof value !== "number" || !Number.isInteger(value) || value < Number(field.minimum) || value > Number(field.maximum)) fail(); }
		else if (field.type !== "boolean" || typeof value !== "boolean") fail();
	}
}

export async function nativeAgentTurn(request: NativeAgentRequest, signal?: AbortSignal): Promise<NativeAgentReply> {
	const body = JSON.stringify(request);
	if (new TextEncoder().encode(body).length > MAX_BYTES) throw new Error("Native agent request exceeds 1 MiB. No tool pairs were dropped.");
	return parseNativeAgentReply(await readAgentJson("/api/playground/agent/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body }, signal, 130_000), request);
}
