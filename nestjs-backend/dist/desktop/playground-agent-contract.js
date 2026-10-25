"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_TIMEOUT_MS = exports.AGENT_MAX_BYTES = void 0;
exports.parseAgentArguments = parseAgentArguments;
exports.validateAgentRequest = validateAgentRequest;
exports.agentUsage = agentUsage;
exports.validateAgentReply = validateAgentReply;
const playground_question_contract_1 = require("./playground-question-contract");
/** Native proposals only. No transport field grants permission to execute a tool. */
exports.AGENT_MAX_BYTES = 1_048_576;
exports.AGENT_TIMEOUT_MS = 120_000;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const CALL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function requireValue(ok) { if (!ok)
    throw new Error("Invalid or oversized native agent contract. No tool was executed."); }
function keys(value, allowed) { requireValue(Object.keys(value).every(key => allowed.includes(key))); }
function wellFormed(value) { return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value); }
function text(value, max) { return typeof value === "string" && value.length <= max && wellFormed(value); }
function integer(value, min, max) { return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max; }
/** The harness's closed, flat JSON Schema subset; unsupported constructs are refused. */
function schema(value) {
    requireValue(object(value));
    keys(value, ["type", "properties", "required", "additionalProperties"]);
    requireValue(value.type === "object" && value.additionalProperties === false && object(value.properties) && Object.keys(value.properties).length <= 32);
    requireValue(Array.isArray(value.required) && value.required.every(key => typeof key === "string" && Object.hasOwn(value.properties, key)) && new Set(value.required).size === value.required.length);
    for (const [name, field] of Object.entries(value.properties)) {
        requireValue(IDENTIFIER.test(name) && object(field));
        keys(field, ["type", "minLength", "maxLength", "minimum", "maximum", "description"]);
        requireValue(field.description === undefined || text(field.description, 512));
        if (field.type === "string") {
            requireValue(integer(field.minLength, 0, 16_384) && integer(field.maxLength, Number(field.minLength), 16_384) && field.minimum === undefined && field.maximum === undefined);
        }
        else if (field.type === "integer") {
            requireValue(integer(field.minimum, -2_147_483_648, 2_147_483_647) && integer(field.maximum, Number(field.minimum), 2_147_483_647) && field.minLength === undefined && field.maxLength === undefined);
        }
        else
            requireValue(field.type === "boolean" && field.minLength === undefined && field.maxLength === undefined && field.minimum === undefined && field.maximum === undefined);
    }
}
/** Parse scalar-only objects without losing duplicate keys (JSON.parse alone loses them). */
function parseAgentArguments(raw) {
    requireValue(text(raw, 16_384) && Buffer.byteLength(raw, "utf8") <= 16_384);
    let index = 0;
    const skip = () => { while (/[ \t\r\n]/.test(raw[index] ?? "") && index < raw.length)
        index++; };
    const stringToken = () => { const token = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(raw.slice(index)); requireValue(token); index += token[0].length; return JSON.parse(token[0]); };
    const result = Object.create(null);
    skip();
    requireValue(raw[index++] === "{");
    skip();
    if (raw[index] !== "}")
        for (;;) {
            const key = stringToken();
            requireValue(wellFormed(key) && !Object.hasOwn(result, key));
            skip();
            requireValue(raw[index++] === ":");
            skip();
            if (raw[index] === '"') {
                const value = stringToken();
                requireValue(wellFormed(value));
                result[key] = value;
            }
            else {
                const token = /^(?:true|false|-?(?:0|[1-9]\d*))(?=[ \t\r\n]*[,}])/.exec(raw.slice(index));
                requireValue(token);
                index += token[0].length;
                result[key] = JSON.parse(token[0]);
            }
            skip();
            if (raw[index] === "}")
                break;
            requireValue(raw[index++] === ",");
            skip();
        }
    requireValue(raw[index++] === "}");
    skip();
    requireValue(index === raw.length);
    return result;
}
function call(value, tools, seen) {
    requireValue(object(value));
    keys(value, ["id", "name", "arguments"]);
    requireValue(typeof value.id === "string" && CALL_ID.test(value.id) && !seen.has(value.id) && typeof value.name === "string" && tools.has(value.name));
    const tool = tools.get(value.name);
    if (tool.name === "question") {
        (0, playground_question_contract_1.parseQuestionForm)(value.arguments);
        seen.add(value.id);
        return { id: value.id, name: value.name, arguments: value.arguments };
    }
    const args = parseAgentArguments(value.arguments);
    const properties = tool.parameters.properties;
    requireValue(tool.parameters.required.every(key => Object.hasOwn(args, key)));
    for (const [key, item] of Object.entries(args)) {
        requireValue(Object.hasOwn(properties, key));
        const field = properties[key];
        if (field.type === "string")
            requireValue(typeof item === "string" && Array.from(item).length >= Number(field.minLength) && Array.from(item).length <= Number(field.maxLength));
        else if (field.type === "integer")
            requireValue(integer(item, Number(field.minimum), Number(field.maximum)));
        else
            requireValue(typeof item === "boolean");
    }
    seen.add(value.id);
    return { id: value.id, name: value.name, arguments: value.arguments };
}
function validateAgentRequest(raw) {
    requireValue(object(raw) && Buffer.byteLength(JSON.stringify(raw), "utf8") <= exports.AGENT_MAX_BYTES);
    keys(raw, ["version", "model", "mode", "message", "system_prompt", "temperature", "max_tokens", "input_context_tokens", "tools", "history", "session_uuid", "compaction_mode", "conversation"]);
    requireValue(raw.version === 1 && text(raw.model, 64) && raw.model.length > 0 && (raw.mode === "plan" || raw.mode === "build"));
    requireValue(text(raw.message, 8000) && raw.message.trim().length > 0 && text(raw.system_prompt ?? "", 2000));
    requireValue(typeof raw.temperature === "number" && Number.isFinite(raw.temperature) && raw.temperature >= 0 && raw.temperature <= 2 && integer(raw.max_tokens, 1, 16_384));
    requireValue([16_384, 32_768, 65_536, 131_072].includes(Number(raw.input_context_tokens)) && typeof raw.input_context_tokens === "number");
    requireValue(raw.session_uuid === undefined || (typeof raw.session_uuid === "string" && UUID.test(raw.session_uuid)));
    requireValue(raw.compaction_mode === undefined || (typeof raw.compaction_mode === "string" && ["permissive", "balanced", "aggressive"].includes(raw.compaction_mode)));
    requireValue(Array.isArray(raw.tools) && raw.tools.length <= 32 && Array.isArray(raw.history) && raw.history.length <= 23);
    const tools = new Map();
    for (const tool of raw.tools) {
        requireValue(object(tool));
        keys(tool, ["name", "description", "effect", "parameters"]);
        requireValue(typeof tool.name === "string" && IDENTIFIER.test(tool.name) && !tools.has(tool.name) && text(tool.description, 2048) && tool.description.length > 0);
        if (tool.name === "question")
            requireValue(tool.effect === "interaction" && (0, playground_question_contract_1.isQuestionSchema)(tool.parameters));
        else {
            requireValue(["read_only", "mutation", "execution"].includes(String(tool.effect)) && (raw.mode !== "plan" || tool.effect === "read_only"));
            schema(tool.parameters);
        }
        tools.set(tool.name, tool);
    }
    const seen = new Set();
    let characters = raw.message.length + String(raw.system_prompt ?? "").length + JSON.stringify(raw.tools).length;
    let groups = 0;
    const history = (items) => {
        requireValue(Array.isArray(items) && items.length <= 23);
        for (const group of items) {
            groups++;
            requireValue(object(group));
            keys(group, ["text", "tool_calls", "tool_results"]);
            requireValue(text(group.text, 32_768) && Array.isArray(group.tool_calls) && group.tool_calls.length >= 1 && group.tool_calls.length <= 8 && Array.isArray(group.tool_results) && group.tool_results.length === group.tool_calls.length);
            const calls = group.tool_calls.map(item => call(item, tools, seen));
            requireValue(!calls.some(item => item.name === "question") || calls.length === 1);
            for (let i = 0; i < calls.length; i++) {
                const result = group.tool_results[i];
                requireValue(object(result));
                keys(result, ["tool_call_id", "content"]);
                requireValue(result.tool_call_id === calls[i].id && text(result.content, 131_072));
                characters += calls[i].arguments.length + calls[i].id.length + calls[i].name.length + result.content.length;
            }
            characters += group.text.length;
        }
    };
    if (raw.conversation !== undefined) {
        requireValue(Array.isArray(raw.conversation) && raw.conversation.length <= 16);
        for (const turn of raw.conversation) {
            requireValue(object(turn));
            keys(turn, ["message", "text", "history"]);
            requireValue(text(turn.message, 8000) && turn.message.trim() && text(turn.text, 32_768));
            groups++;
            characters += turn.message.length + turn.text.length;
            history(turn.history);
        }
    }
    history(raw.history);
    requireValue(groups <= 23 && seen.size <= 48 && characters <= 262_144);
    return { ...raw, system_prompt: raw.system_prompt ?? "" };
}
function agentUsage(raw) {
    if (!object(raw) || !integer(raw.prompt_tokens, 0, 2_147_483_647) || !integer(raw.completion_tokens, 0, 2_147_483_647) || raw.prompt_tokens + raw.completion_tokens === 0)
        return null;
    return { prompt_tokens: raw.prompt_tokens, completion_tokens: raw.completion_tokens };
}
function validateAgentReply(raw, request) {
    requireValue(object(raw) && raw.version === 1 && text(raw.text, 32_768) && Array.isArray(raw.tool_calls) && raw.tool_calls.length <= 8);
    const usage = agentUsage(raw.usage);
    requireValue(usage && usage.completion_tokens <= request.max_tokens);
    requireValue((raw.finish_reason === "stop" && raw.tool_calls.length === 0) || (raw.finish_reason === "tool_calls" && raw.tool_calls.length > 0));
    const seen = new Set([...(request.conversation ?? []).flatMap(turn => turn.history.flatMap(group => group.tool_calls.map(item => item.id))), ...request.history.flatMap(group => group.tool_calls.map(item => item.id))]);
    const tools = new Map(request.tools.map(tool => [tool.name, tool]));
    const calls = raw.tool_calls.map(item => call(item, tools, seen));
    requireValue(!calls.some(item => item.name === "question") || calls.length === 1);
    requireValue(seen.size <= 48);
    let compaction;
    if (raw.compaction !== undefined) {
        const value = raw.compaction;
        requireValue(object(value));
        keys(value, ["mode", "inputLimit", "tokensBefore", "tokensAfter", "compacted", "consumedGroups", "summary", "usage"]);
        requireValue(value.mode === (request.compaction_mode ?? "balanced") && value.inputLimit === request.input_context_tokens &&
            integer(value.tokensBefore, 0, 2_147_483_647) && integer(value.tokensAfter, 0, 2_147_483_647) && typeof value.compacted === "boolean");
        const summaryUsage = agentUsage(value.usage);
        if (value.compacted)
            requireValue(integer(value.consumedGroups, 1, request.history.length + (request.conversation?.length ?? 0) - 1) && text(value.summary, 32_000) && value.summary.trim() &&
                Number(value.tokensAfter) < Number(value.tokensBefore) && Number(value.tokensAfter) < Math.min(Math.floor(request.input_context_tokens * ({ permissive: .8, balanced: .65, aggressive: .45 }[String(value.mode)])), 131_072 - request.max_tokens - 256) &&
                summaryUsage && summaryUsage.prompt_tokens <= usage.prompt_tokens && summaryUsage.completion_tokens <= Math.min(Math.floor(request.max_tokens / 4), 2048) && summaryUsage.completion_tokens <= usage.completion_tokens);
        else
            requireValue(value.consumedGroups === 0 && value.tokensBefore === value.tokensAfter && value.summary === undefined && value.usage === null);
        compaction = value;
    }
    return { version: 1, text: raw.text, finish_reason: raw.finish_reason, tool_calls: calls, usage, ...(compaction ? { compaction } : {}) };
}
