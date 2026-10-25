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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaygroundSandboxService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const billing_service_1 = require("../billing/billing.service");
const addons_service_1 = require("../billing/addons.service");
const tier_allowance_1 = require("../billing/tier-allowance");
const httpClient_1 = require("../common/utils/httpClient");
const playground_run_events_service_1 = require("./playground-run-events.service");
const CONTAINER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** `exec-` + 12 random bytes, one per durable execution attempt, minted by this service like the gateway mints `dsk-`. */
function attemptId() {
    return `exec-${crypto.randomBytes(12).toString("hex")}`;
}
let PlaygroundSandboxService = class PlaygroundSandboxService {
    billing;
    addons;
    events;
    constructor(billing, addons, events) {
        this.billing = billing;
        this.addons = addons;
        this.events = events;
    }
    async headers(accountId, requireAccess = true) {
        if (!Number.isSafeInteger(accountId) || accountId <= 0)
            throw new common_1.ForbiddenException();
        const key = process.env.PLAYGROUND_SANDBOX_KEY || "";
        if (!process.env.PLAYGROUND_SANDBOX_URL || key.length < 32)
            throw new common_1.ServiceUnavailableException({ error: "SANDBOX_NOT_CONFIGURED", message: "Hosted execution is not configured on this server." });
        if (requireAccess) {
            const tier = await this.billing.resolveTierFor(accountId);
            const access = await this.addons.resolveSpectreAccess(accountId, tier, (0, tier_allowance_1.canUseSpectre)(tier));
            if (!access.hasAccess)
                throw new common_1.ForbiddenException({ error: "PLAYGROUND_LOCKED" });
        }
        return { "Content-Type": "application/json", "x-sandbox-key": key, "x-sandbox-owner": String(accountId) };
    }
    url(path) { return `${process.env.PLAYGROUND_SANDBOX_URL.replace(/\/+$/, "")}${path}`; }
    async request(accountId, method, path, body, signal) {
        // Losing entitlement must not prevent an authenticated owner from discarding an
        // existing workload. The broker independently checks ownership on DELETE.
        const headers = await this.headers(accountId, method !== "DELETE");
        signal?.throwIfAborted();
        try {
            const response = await (0, httpClient_1.fetchBounded)(this.url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024, redirect: "error" });
            const result = await response.json();
            if (!response.ok)
                throw new common_1.HttpException({ error: "SANDBOX_REFUSED", message: typeof result.detail === "string" ? result.detail : result.message || "Sandbox operation refused." }, response.status);
            this.recordWorkspace(accountId, method, path, result);
            return result;
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.ServiceUnavailableException({ error: "SANDBOX_UNAVAILABLE", message: "The hosted sandbox could not be reached." });
        }
    }
    /** Bounded, terminal broker evidence for the agent action service. No client-reported
     * output is accepted; any missing/ambiguous completion must quarantine the workspace. */
    async agentCommand(accountId, identity, command, signal) {
        if (!CONTAINER_ID_PATTERN.test(identity))
            throw new common_1.ForbiddenException();
        const headers = await this.headers(accountId);
        signal?.throwIfAborted();
        const response = await (0, httpClient_1.fetchBounded)(this.url(`/sandboxes/${identity}/run`), { method: "POST", headers, signal,
            body: JSON.stringify({ command, approved: true, timeoutSeconds: 30 }), timeoutMs: 75_000, maxBytes: 8 * 1024 * 1024, redirect: "error" });
        if (!response.ok)
            throw new common_1.ServiceUnavailableException({ error: "AGENT_TOOL_REFUSED" });
        let started = null;
        let terminal = null;
        let stdout = "", stderr = "";
        for (const line of (await response.text()).split("\n")) {
            if (!line.trim())
                continue;
            if (!line.startsWith("data:"))
                throw new Error("Invalid broker frame.");
            const frame = JSON.parse(line.slice(5));
            if (!frame || terminal)
                throw new Error("Invalid broker completion sequence.");
            if (frame.event === "execution.started") {
                if (started || typeof frame.runId !== "string" || !CONTAINER_ID_PATTERN.test(frame.runId) || frame.location !== "hosted-docker" || frame.cwd !== "/workspace")
                    throw new Error("Invalid broker start.");
                started = frame.runId;
            }
            else if (frame.event === "execution.output") {
                if (!started || typeof frame.text !== "string" || !["stdout", "stderr"].includes(frame.stream || ""))
                    throw new Error("Invalid broker output.");
                if (frame.stream === "stdout")
                    stdout += frame.text;
                else
                    stderr += frame.text;
                if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8") > 1024 * 1024)
                    throw new Error("Broker output limit exceeded.");
            }
            else if (frame.event === "execution.finished") {
                if (!started || frame.runId !== started || typeof frame.stopped !== "boolean" || typeof frame.seconds !== "number" || !Number.isFinite(frame.seconds) || frame.seconds < 0 || frame.seconds > 90 ||
                    (!frame.stopped && (typeof frame.exitCode !== "number" || !Number.isInteger(frame.exitCode) || frame.exitCode < -2_147_483_648 || frame.exitCode > 2_147_483_647)))
                    throw new Error("Invalid broker terminal result.");
                terminal = { exitCode: frame.stopped ? -1 : frame.exitCode, timedOut: frame.stopped, durationMs: Math.round(frame.seconds * 1000) };
            }
            else
                throw new Error("Broker reported an unknown/failed execution.");
        }
        if (!terminal)
            throw new Error("No broker completion was recorded.");
        return { stdout, stderr, ...terminal };
    }
    /**
     * Workspace lifecycle events ride on the exact paths that create or discard one; a
     * generic proxy method records nothing else. A failed create never reaches here because
     * the throw leaves first, and a workspace the broker never confirmed is not a row.
     */
    recordWorkspace(accountId, method, path, result) {
        if (!this.events)
            return;
        const identity = typeof result.id === "string" && CONTAINER_ID_PATTERN.test(result.id) ? result.id : null;
        if (method === "POST" && path === "/sandboxes" && identity) {
            this.events.record(accountId, attemptId(), "workspace.created", { payload: { sandbox_id: identity, network: result.network === "disabled" ? "disabled" : undefined, ephemeral: true } });
            return;
        }
        const discarded = method === "DELETE" ? /^\/sandboxes\//.test(path) : false;
        if (discarded)
            this.events.record(accountId, attemptId(), "workspace.discarded", { payload: { sandbox_id: path.slice("/sandboxes/".length, "/sandboxes/".length + 64) }, status: "complete" });
    }
    async run(accountId, identity, body, res) {
        const headers = await this.headers(accountId);
        // One replayable stream per attempt, minted here even when the broker never answers:
        // a run refused before any execution exists still needs its approval recorded. The
        // per-attempt shape matches the gateway's generation ids (`dsk-`/`exec-` + 12 bytes).
        const runId = attemptId();
        const command = typeof body?.command === "string" ? body.command : "";
        this.events?.record(accountId, runId, "execution.approved", { payload: { sandbox_id: identity, command, timeout_seconds: typeof body?.timeoutSeconds === "number" ? body.timeoutSeconds : undefined } });
        const controller = new AbortController();
        const abort = () => controller.abort();
        const timeout = setTimeout(abort, 75_000);
        res.once("close", abort);
        const recorded = { terminal: false };
        try {
            const upstream = await fetch(this.url(`/sandboxes/${identity}/run`), { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal, redirect: "error" });
            if (!upstream.ok || !upstream.body) {
                const detail = await upstream.json().catch(() => ({}));
                this.events?.record(accountId, runId, "execution.failed", { payload: { sandbox_id: identity, command, refused_status: upstream.status }, status: "failed" });
                const refused = new common_1.HttpException({ error: "EXECUTION_REFUSED", message: typeof detail.detail === "string" ? detail.detail : "Execution was refused." }, upstream.status);
                throw refused;
            }
            res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
            res.flushHeaders();
            const reader = upstream.body.getReader();
            const decoder = new TextDecoder();
            let pending = "";
            let size = 0;
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    size += value.byteLength;
                    if (size > 8 * 1024 * 1024) {
                        controller.abort();
                        throw new Error("Execution event limit reached");
                    }
                    if (!res.write(Buffer.from(value)))
                        await new Promise(resolve => { res.once("drain", resolve); controller.signal.addEventListener("abort", () => resolve(), { once: true }); });
                    // The bytes are forwarded untouched; this pass only reads for the durable
                    // record, splitting on the same rule the console rendering uses.
                    pending += decoder.decode(value, { stream: true });
                    const lines = pending.split("\n");
                    pending = lines.pop() ?? "";
                    for (const line of lines)
                        await this.recordBrokerFrame(accountId, runId, identity, command, line, recorded);
                }
                pending += decoder.decode();
                for (const line of pending.split("\n"))
                    await this.recordBrokerFrame(accountId, runId, identity, command, line, recorded);
            }
            finally {
                await reader.cancel().catch(() => undefined);
            }
        }
        catch (error) {
            if (res.headersSent) {
                if (!res.destroyed)
                    res.write(`data: ${JSON.stringify({ event: "execution.failed", message: "Execution stream interrupted. Stop the workspace before retrying." })}\n\n`);
                if (!recorded.terminal) {
                    recorded.terminal = true;
                    this.events?.record(accountId, runId, "execution.failed", { payload: { sandbox_id: identity, command, reason: "stream_interrupted" }, status: "failed" });
                }
            }
            else if (error instanceof common_1.HttpException)
                throw error;
            else
                throw new common_1.ServiceUnavailableException({ error: "SANDBOX_UNAVAILABLE" });
        }
        finally {
            clearTimeout(timeout);
            res.off("close", abort);
            if (res.headersSent)
                res.end();
        }
    }
    /**
     * Broker frame to durable event. Kind-for-kind only when the frame kind is known; a
     * chatty command is bounded by the recorder's per-run cap, whose truncation marker keeps
     * the bounded log honest about where it was cut.
     */
    async recordBrokerFrame(accountId, runId, identity, command, line, recorded) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:"))
            return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]")
            return;
        let frame;
        try {
            frame = JSON.parse(payload);
        }
        catch {
            return;
        }
        if (!this.events || !frame.event)
            return;
        const record = (kind, eventPayload, status) => this.events.record(accountId, runId, kind, { payload: eventPayload, status });
        switch (frame.event) {
            case "execution.started":
                await record("execution.started", { sandbox_id: identity, broker_run_id: frame.runId, location: frame.location, cwd: frame.cwd, command }, "pending");
                break;
            case "execution.output":
                await record("execution.output", { stream: frame.stream, text: frame.text }, "pending");
                break;
            case "execution.finished":
                recorded.terminal = true;
                await record("execution.finished", { sandbox_id: identity, broker_run_id: frame.runId, exit_code: frame.exitCode, stopped: frame.stopped === true, seconds: frame.seconds }, "complete");
                break;
            case "execution.failed":
                recorded.terminal = true;
                await record("execution.failed", { sandbox_id: identity, broker_run_id: frame.runId, reason: frame.message || "broker_reported_failure" }, "failed");
                break;
            default:
                // Unknown broker kinds are forwarded to the client but never guessed into rows.
                break;
        }
    }
};
exports.PlaygroundSandboxService = PlaygroundSandboxService;
exports.PlaygroundSandboxService = PlaygroundSandboxService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [billing_service_1.BillingService, addons_service_1.AddonsService, playground_run_events_service_1.PlaygroundRunEventsService])
], PlaygroundSandboxService);
