import { Injectable } from "@nestjs/common";
import * as crypto from "crypto";
import { parseAgentArguments, type AgentCall, type AgentReply, type AgentRequest } from "./playground-agent-contract";
import { playgroundModelFile, playgroundTextModelKeys } from "./text-models";

export type ActionTicket = { tool_call_id: string; token: string; expires_at: number };
export type ActionClaims = { version: 1; account: number; run: string; model: string; mode: "plan" | "build";
	call: string; name: string; digest: string; expires: number; session: string | null; scope: "desktop" | "playground" };
export type ExecutableCall = { call: AgentCall; effect: "read_only" | "mutation" | "execution"; args: Record<string, string> };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const RUN = /^dsk-[0-9a-f]{24}$/;
const CALL = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ACTION_TTL_SECONDS = 300;
export const actionDigest = (call: AgentCall) => crypto.createHash("sha256").update(call.arguments, "utf8").digest("hex");

function workspacePath(value: string): boolean {
	return !!value && value.length <= 240 && !/[\x00-\x1f\x7f-\x9f\\:*?"<>|]/.test(value) && value.split("/").every(part => {
		if (!part || part === "." || part === ".." || /[ .]$/.test(part)) return false;
		return !/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])$/.test(part.split(".")[0].trimEnd().toUpperCase());
	});
}

/** Execution policy is fixed by the SERVER, never by a caller's tool effect/schema. */
export function executableCall(raw: unknown, mode: "plan" | "build"): ExecutableCall {
	if (!object(raw) || Object.keys(raw).some(key => !["id", "name", "arguments"].includes(key)) || typeof raw.id !== "string" || !CALL.test(raw.id) ||
		typeof raw.name !== "string" || !["read_file", "write_file", "run_command"].includes(raw.name) || (mode !== "plan" && mode !== "build") || (mode === "plan" && raw.name !== "read_file")) throw new Error("Invalid executable tool.");
	const parsed = parseAgentArguments(raw.arguments);
	const fields = raw.name === "read_file" ? ["path"] : raw.name === "write_file" ? ["path", "text"] : ["command"];
	if (Object.keys(parsed).length !== fields.length || fields.some(key => typeof parsed[key] !== "string")) throw new Error("Invalid executable arguments.");
	const args = parsed as Record<string, string>;
	if (raw.name !== "run_command" && !workspacePath(args.path)) throw new Error("Invalid workspace path.");
	if (raw.name === "write_file" && Array.from(args.text).length > 12_000) throw new Error("File proposal too large.");
	if (raw.name === "run_command" && (!args.command.trim() || Array.from(args.command).length > 4000)) throw new Error("Invalid command.");
	return { call: { id: raw.id, name: raw.name, arguments: raw.arguments as string }, args,
		effect: raw.name === "read_file" ? "read_only" : raw.name === "write_file" ? "mutation" : "execution" };
}

/** Short-lived, account/call/digest-bound MODEL evidence, not consent. Nothing retains raw
 * arguments here. A durable one-shot database claim is still required before dispatch. */
@Injectable()
export class PlaygroundAgentTicketsService {
	configured(): boolean { return process.env.PLAYGROUND_AGENT_EXECUTION_ENABLED === "true" && this.key().length >= 32; }
	private key(): string { return (process.env.PLAYGROUND_AGENT_ACTION_KEY || "").trim(); }
	modelEnabled(model: string): boolean {
		const files = (process.env.PLAYGROUND_AGENT_MODEL_FILES || "").split(",").map(value => value.trim());
		return !!process.env.AI_SERVICE_KEY?.trim() && playgroundTextModelKeys().includes(model) && files.includes(playgroundModelFile(model)!);
	}
	issue(account: number, request: AgentRequest, reply: AgentReply, run: string, scope: "desktop" | "playground"): ActionTicket[] {
		if (!this.configured() || !this.modelEnabled(request.model) || !RUN.test(run) || !Number.isSafeInteger(account) || account <= 0) return [];
		const expires = Math.floor(Date.now() / 1000) + ACTION_TTL_SECONDS;
		return reply.tool_calls.flatMap(call => {
			try { executableCall(call, request.mode); } catch { return []; }
			const claims: ActionClaims = { version: 1, account, run, model: request.model, mode: request.mode, call: call.id, name: call.name,
				digest: actionDigest(call), expires, session: request.session_uuid ?? null, scope };
			const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
			return [{ tool_call_id: call.id, expires_at: expires, token: payload + "." + crypto.createHmac("sha256", this.key()).update(payload).digest("base64url") }];
		});
	}
	verify(token: unknown, account: number, rawCall: unknown): { claims: ActionClaims; proposal: ExecutableCall } {
		if (!this.configured() || typeof token !== "string" || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Execution is disabled or the model ticket is invalid.");
		const [payload, signature] = token.split(".");
		const expected = crypto.createHmac("sha256", this.key()).update(payload).digest();
		if (!crypto.timingSafeEqual(expected, Buffer.from(signature, "base64url"))) throw new Error("Invalid model ticket.");
		const claims: ActionClaims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		const now = Math.floor(Date.now() / 1000);
		if (!claims || claims.version !== 1 || claims.account !== account || !RUN.test(claims.run) || !this.modelEnabled(claims.model) ||
			!Number.isSafeInteger(claims.expires) || claims.expires <= now || claims.expires > now + ACTION_TTL_SECONDS ||
			(claims.session !== null && !UUID.test(claims.session)) || !["desktop", "playground"].includes(claims.scope)) throw new Error("Expired or mismatched model ticket.");
		const proposal = executableCall(rawCall, claims.mode);
		if (proposal.call.id !== claims.call || proposal.call.name !== claims.name || actionDigest(proposal.call) !== claims.digest) throw new Error("The action differs from the settled model proposal.");
		return { claims, proposal };
	}
}
