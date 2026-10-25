"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaygroundAgentTicketsService = exports.actionDigest = exports.ACTION_TTL_SECONDS = void 0;
exports.executableCall = executableCall;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const playground_agent_contract_1 = require("./playground-agent-contract");
const text_models_1 = require("./text-models");
const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const RUN = /^dsk-[0-9a-f]{24}$/;
const CALL = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
exports.ACTION_TTL_SECONDS = 300;
const actionDigest = (call) => crypto.createHash("sha256").update(call.arguments, "utf8").digest("hex");
exports.actionDigest = actionDigest;
function workspacePath(value) {
    return !!value && value.length <= 240 && !/[\x00-\x1f\x7f-\x9f\\:*?"<>|]/.test(value) && value.split("/").every(part => {
        if (!part || part === "." || part === ".." || /[ .]$/.test(part))
            return false;
        return !/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])$/.test(part.split(".")[0].trimEnd().toUpperCase());
    });
}
/** Execution policy is fixed by the SERVER, never by a caller's tool effect/schema. */
function executableCall(raw, mode) {
    if (!object(raw) || Object.keys(raw).some(key => !["id", "name", "arguments"].includes(key)) || typeof raw.id !== "string" || !CALL.test(raw.id) ||
        typeof raw.name !== "string" || !["read_file", "write_file", "run_command"].includes(raw.name) || (mode !== "plan" && mode !== "build") || (mode === "plan" && raw.name !== "read_file"))
        throw new Error("Invalid executable tool.");
    const parsed = (0, playground_agent_contract_1.parseAgentArguments)(raw.arguments);
    const fields = raw.name === "read_file" ? ["path"] : raw.name === "write_file" ? ["path", "text"] : ["command"];
    if (Object.keys(parsed).length !== fields.length || fields.some(key => typeof parsed[key] !== "string"))
        throw new Error("Invalid executable arguments.");
    const args = parsed;
    if (raw.name !== "run_command" && !workspacePath(args.path))
        throw new Error("Invalid workspace path.");
    if (raw.name === "write_file" && Array.from(args.text).length > 12_000)
        throw new Error("File proposal too large.");
    if (raw.name === "run_command" && (!args.command.trim() || Array.from(args.command).length > 4000))
        throw new Error("Invalid command.");
    return { call: { id: raw.id, name: raw.name, arguments: raw.arguments }, args,
        effect: raw.name === "read_file" ? "read_only" : raw.name === "write_file" ? "mutation" : "execution" };
}
/** Short-lived, account/call/digest-bound MODEL evidence, not consent. Nothing retains raw
 * arguments here. A durable one-shot database claim is still required before dispatch. */
let PlaygroundAgentTicketsService = class PlaygroundAgentTicketsService {
    configured() { return process.env.PLAYGROUND_AGENT_EXECUTION_ENABLED === "true" && this.key().length >= 32; }
    key() { return (process.env.PLAYGROUND_AGENT_ACTION_KEY || "").trim(); }
    modelEnabled(model) {
        const files = (process.env.PLAYGROUND_AGENT_MODEL_FILES || "").split(",").map(value => value.trim());
        return !!process.env.AI_SERVICE_KEY?.trim() && (0, text_models_1.playgroundTextModelKeys)().includes(model) && files.includes((0, text_models_1.playgroundModelFile)(model));
    }
    issue(account, request, reply, run, scope) {
        if (!this.configured() || !this.modelEnabled(request.model) || !RUN.test(run) || !Number.isSafeInteger(account) || account <= 0)
            return [];
        const expires = Math.floor(Date.now() / 1000) + exports.ACTION_TTL_SECONDS;
        return reply.tool_calls.flatMap(call => {
            try {
                executableCall(call, request.mode);
            }
            catch {
                return [];
            }
            const claims = { version: 1, account, run, model: request.model, mode: request.mode, call: call.id, name: call.name,
                digest: (0, exports.actionDigest)(call), expires, session: request.session_uuid ?? null, scope };
            const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
            return [{ tool_call_id: call.id, expires_at: expires, token: payload + "." + crypto.createHmac("sha256", this.key()).update(payload).digest("base64url") }];
        });
    }
    verify(token, account, rawCall) {
        if (!this.configured() || typeof token !== "string" || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
            throw new Error("Execution is disabled or the model ticket is invalid.");
        const [payload, signature] = token.split(".");
        const expected = crypto.createHmac("sha256", this.key()).update(payload).digest();
        if (!crypto.timingSafeEqual(expected, Buffer.from(signature, "base64url")))
            throw new Error("Invalid model ticket.");
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        const now = Math.floor(Date.now() / 1000);
        if (!claims || claims.version !== 1 || claims.account !== account || !RUN.test(claims.run) || !this.modelEnabled(claims.model) ||
            !Number.isSafeInteger(claims.expires) || claims.expires <= now || claims.expires > now + exports.ACTION_TTL_SECONDS ||
            (claims.session !== null && !UUID.test(claims.session)) || !["desktop", "playground"].includes(claims.scope))
            throw new Error("Expired or mismatched model ticket.");
        const proposal = executableCall(rawCall, claims.mode);
        if (proposal.call.id !== claims.call || proposal.call.name !== claims.name || (0, exports.actionDigest)(proposal.call) !== claims.digest)
            throw new Error("The action differs from the settled model proposal.");
        return { claims, proposal };
    }
};
exports.PlaygroundAgentTicketsService = PlaygroundAgentTicketsService;
exports.PlaygroundAgentTicketsService = PlaygroundAgentTicketsService = __decorate([
    (0, common_1.Injectable)()
], PlaygroundAgentTicketsService);
