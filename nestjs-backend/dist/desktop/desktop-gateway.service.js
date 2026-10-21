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
var DesktopGatewayService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopGatewayService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const billing_service_1 = require("../billing/billing.service");
const addons_service_1 = require("../billing/addons.service");
const tier_allowance_1 = require("../billing/tier-allowance");
const text_models_1 = require("./text-models");
const desktop_policy_1 = require("./desktop-policy");
/** Mirrors the web route's clamps, so the two surfaces cannot disagree on what is legal. */
const MAX_MESSAGE_LENGTH = 8000;
const MAX_SYSTEM_PROMPT_LENGTH = 2000;
// The native client offers the same 16K / 32K / 64K / 128K levels as the web UI.
const MAX_MAX_TOKENS = 131_072;
const DEFAULT_MAX_TOKENS = 512;
const MAX_TEMPERATURE = 2;
const DEFAULT_TEMPERATURE = 0.7;
/**
 * The metered inference path for the desktop client.
 *
 * This exists because there was nowhere else for a native client to send a request. The web
 * Playground is a Next route (`src/app/api/playground/chat/route.ts`) that calls the Python
 * AI service directly, and that service is published on port 5000 with no authentication at
 * all. A desktop client pointed at it would generate for free, unmetered, with no
 * entitlement check anywhere in the path.
 *
 * So the order of operations is the whole design, and it is deliberately the order the
 * authoritative Kafelot choke point uses (`kafelot.controller.ts:188-211`):
 *
 *   1. authenticate            -- the guard; a bearer token, no cookie
 *   2. validate the request     -- cheap, and before anything expensive
 *   3. resolve entitlement      -- does this account have the Playground at all
 *   4. money gate              -- can it pay, *before* the model is loaded
 *   5. stream                  -- only now does a GPU do work
 *   6. meter on the done frame -- with an idempotency key
 *
 * Step 4 before step 5 is the part that matters most. Serving first and charging afterwards
 * means a customer with no money still consumed the inference, and it is the reason the
 * allowance check moved ahead of generation in the first place.
 */
let DesktopGatewayService = DesktopGatewayService_1 = class DesktopGatewayService {
    billing;
    addons;
    logger = new common_1.Logger(DesktopGatewayService_1.name);
    constructor(billing, addons) {
        this.billing = billing;
        this.addons = addons;
    }
    /** Where the AI service lives. In-network by name; loopback when the backend runs bare. */
    aiHost() {
        const configured = String(process.env.PYTHON_AI_HOST || "").trim();
        return (configured || "http://ai:5000").replace(/\/+$/, "");
    }
    /**
     * Headers for a call to the AI service.
     *
     * The service key is sent only when one is configured. Sending an empty one would be
     * worse than sending none: it looks like an attempt to authenticate, and a future
     * version of the service that compared an absent header differently from an empty one
     * would refuse this call while every other caller carried on working.
     */
    upstreamHeaders() {
        const headers = {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
        };
        const key = String(process.env.AI_SERVICE_KEY || "").trim();
        if (key)
            headers["x-ai-service-key"] = key;
        return headers;
    }
    clampNumber(value, min, max, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n))
            return fallback;
        return Math.min(max, Math.max(min, n));
    }
    clampText(value, max) {
        return typeof value === "string" ? value.slice(0, max) : "";
    }
    /**
     * Refusals, kept as data so the caller can turn one into a response without this method
     * needing to know about HTTP.
     *
     * 402 and 503 are different on purpose. "You cannot pay" is the customer's problem;
     * "we could not find out whether you can pay" is ours, and answering 402 to a billing
     * outage sends a paying customer to top up a wallet that is not the problem.
     */
    async refuse(accountId, tier, modelKey) {
        let accessSource = null;
        try {
            const access = await this.addons.resolveSpectreAccess(accountId, tier, (0, tier_allowance_1.canUseSpectre)(tier));
            accessSource = access.source;
            if (!access.hasAccess) {
                return {
                    accessSource,
                    refusal: {
                        kind: "refused",
                        status: 403,
                        error: "PLAYGROUND_LOCKED",
                        message: "The Playground needs the Spectre subscription or a Max/Ultimate plan.",
                    },
                };
            }
            // Per-model affordability, from the same policy the charge is resolved with.
            //
            // A plain "can this account afford anything" check is not enough here. An add-on
            // holder cannot spend their plan allowance on the Playground -- the subscription buys
            // access, not usage -- and Max cannot pay for the 8B out of its allowance. Deciding
            // it in one place keeps the catalogue and the gate from disagreeing.
            const [balance, allowance] = await Promise.all([
                this.billing.getBalance(accountId),
                this.billing.getAllowance(accountId, tier),
            ]);
            const gate = (0, desktop_policy_1.desktopModelAccess)({
                modelKey,
                tier,
                accessSource,
                walletCanGenerate: balance.canGenerate,
                allowanceRemainingRon: allowance.remainingRon,
            });
            if (!gate.canGenerate) {
                return {
                    accessSource,
                    refusal: {
                        kind: "refused",
                        status: 402,
                        error: "INSUFFICIENT_BALANCE",
                        message: "Your monthly allowance and Playground balance are both spent.",
                    },
                };
            }
        }
        catch (err) {
            // Fail closed. An unreachable billing service must not become a free generation.
            this.logger.error(`desktop money gate failed for account ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
            return {
                accessSource,
                refusal: {
                    kind: "refused",
                    status: 503,
                    error: "BILLING_UNAVAILABLE",
                    message: "We could not check your balance right now. Please try again in a moment.",
                },
            };
        }
        return { refusal: null, accessSource };
    }
    /**
     * Stream one generation, and meter it.
     *
     * `requestId` is generated here rather than accepted from the client. The client has no
     * reason to choose it and every reason to reuse one: a stable key is exactly what makes
     * the report idempotent, and a client-supplied value would let a retry be shaped to look
     * like a different request. The web route passes `requestId: null` and leans on the
     * stream firing once; this path does not have to accept that.
     */
    async streamChat(res, accountId, tier, body) {
        const modelKey = String(body?.model ?? body?.modelKey ?? "").trim();
        const modelFile = (0, text_models_1.playgroundModelFile)(modelKey);
        if (!modelFile) {
            return {
                kind: "refused",
                status: 400,
                error: "UNKNOWN_MODEL",
                message: "That model is not available in the Playground.",
            };
        }
        const message = this.clampText(body?.message, MAX_MESSAGE_LENGTH).trim();
        if (!message) {
            return { kind: "refused", status: 400, error: "MESSAGE_REQUIRED", message: "message is required" };
        }
        // Resolved once, then passed down explicitly. Holding it on the service instance would
        // be a race: Nest services are singletons, so two streams in flight would overwrite each
        // other's access source and one of them would be billed from the wrong pot -- an add-on
        // customer charged at their tier's allowance rate, or the reverse.
        const gate = await this.refuse(accountId, tier, modelKey);
        if (gate.refusal)
            return gate.refusal;
        const accessSource = gate.accessSource;
        // Thinking is restricted by plan, and it is decided from the server's own tier rather
        // than the request -- the same reasoning as the web route.
        const enableThinking = (body?.thinking === true || body?.thinking === "true") && this.tierAllowsThinking(tier);
        const requestId = `dsk-${crypto.randomBytes(12).toString("hex")}`;
        // An explicit AbortController rather than AbortSignal.timeout, to match how every
        // other service in this backend bounds its outbound calls (and to satisfy the
        // phase7-bounded-io invariant, which is right to insist that a timeout is visible in
        // the source rather than assumed).
        //
        // The bound is on the whole exchange, not on connect: a streaming generation legitimately
        // runs for minutes, and the thing that must never happen is a socket left open
        // indefinitely holding a connection from the pool.
        const upstreamController = new AbortController();
        const upstreamTimeout = setTimeout(() => upstreamController.abort(), Number(process.env.DESKTOP_STREAM_TIMEOUT_MS || "300000"));
        let upstream;
        try {
            upstream = await fetch(`${this.aiHost()}/api/chat/stream`, {
                method: "POST",
                headers: this.upstreamHeaders(),
                signal: upstreamController.signal,
                body: JSON.stringify({
                    message,
                    system_prompt: this.clampText(body?.system_prompt ?? body?.systemPrompt, MAX_SYSTEM_PROMPT_LENGTH),
                    text_model: modelFile,
                    temperature: this.clampNumber(body?.temperature, 0, MAX_TEMPERATURE, DEFAULT_TEMPERATURE),
                    max_tokens: Math.round(this.clampNumber(body?.max_tokens ?? body?.maxTokens, 1, MAX_MAX_TOKENS, DEFAULT_MAX_TOKENS)),
                    enable_thinking: enableThinking,
                    // Threaded into the AI service so its own logs can be correlated with the
                    // charge. It is not the billing idempotency key, which is generated below.
                    request_id: requestId,
                }),
            });
        }
        catch (err) {
            clearTimeout(upstreamTimeout);
            this.logger.error(`desktop upstream fetch failed for account ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
            return {
                kind: "refused",
                status: 502,
                error: "UPSTREAM_UNAVAILABLE",
                message: "The model service could not be reached.",
            };
        }
        if (!upstream.ok || !upstream.body) {
            clearTimeout(upstreamTimeout);
            // 429 from the model service means its single llama.cpp slot is busy -- usually
            // because a model swap is loading, which takes minutes. That is a retryable
            // condition and not a failure, and it gets its own code so the client can say
            // "the model is loading" rather than "the model service could not complete that
            // request". Collapsing the two would leave the user staring at an error while
            // the model finishes loading underneath them.
            if (upstream.status === 429) {
                this.logger.warn(`desktop model service is busy for account ${accountId}`);
                return {
                    kind: "refused",
                    status: 503,
                    error: "MODEL_BUSY",
                    message: "The model is being loaded. Please try again in a moment.",
                };
            }
            this.logger.warn(`desktop upstream returned HTTP ${upstream.status} for account ${accountId}`);
            return {
                kind: "refused",
                status: 502,
                error: "UPSTREAM_ERROR",
                message: "The model service could not complete that request.",
            };
        }
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        // Proxies buffer streamed responses unless told not to; the buffered version of a
        // token stream defeats the point of having one.
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("x-filspresso-request-id", requestId);
        res.flushHeaders?.();
        // `await`ed before returning: the controller has already handed the socket over, and
        // the meter has to keep reading after this method's caller believes it is finished.
        try {
            await this.pipeAndMeter(res, upstream.body, accountId, tier, modelKey, requestId, accessSource);
        }
        finally {
            // Cleared here rather than left to fire: a five-minute timer outliving its request
            // keeps the controller and its closure alive for every concurrent stream.
            clearTimeout(upstreamTimeout);
        }
        return { kind: "sent", requestId };
    }
    /**
     * Copy the upstream stream through, and bill on the frame that says the work finished.
     *
     * A frame can straddle two TCP reads, so a partial line is held between chunks. Dropping
     * one would lose the done frame, and a lost done frame means a completed generation that
     * nobody is charged for -- the customer got the tokens and the meter never saw them.
     */
    async pipeAndMeter(res, upstreamBody, accountId, tier, modelKey, requestId, accessSource) {
        const reader = upstreamBody.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        let metered = false;
        const billIfDone = async (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:"))
                return;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]")
                return;
            let event;
            try {
                event = JSON.parse(payload);
            }
            catch {
                return;
            }
            if (!event.done || metered)
                return;
            const usage = readUsageBlock(event.usage);
            if (!usage)
                return;
            if (usage.inputTokens <= 0 && usage.outputTokens <= 0)
                return;
            metered = true;
            try {
                await this.billing.recordUsage({
                    accountId,
                    modelKey,
                    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
                    scope: "desktop",
                    // Supplied from the server's own resolution, never from the request. The pot
                    // depends on which product granted access: an add-on holder pays from the
                    // wallet alone, and a Max customer draws on their allowance.
                    tier,
                    accessSource,
                    // The idempotency key. Same value as the header the client was given, so a
                    // retried report for this stream cannot charge twice.
                    requestId,
                });
            }
            catch (err) {
                // The customer already has their tokens. Failing the stream now would take
                // work away from someone who was paid for, so the charge is logged and the
                // generation stands. A lost charge is an accounting problem; a withdrawn
                // answer is a worse one.
                this.logger.error(`desktop usage metering failed for request ${requestId} (account ${accountId}): ${err instanceof Error ? err.message : String(err)}`);
            }
        };
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (value)
                    res.write(Buffer.from(value));
                pending += decoder.decode(value ?? new Uint8Array(), { stream: true });
                const lines = pending.split("\n");
                // The last element is either an empty string or an incomplete line; either way
                // it stays for the next read.
                pending = lines.pop() ?? "";
                for (const line of lines)
                    await billIfDone(line);
            }
            pending += decoder.decode();
            for (const line of pending.split("\n"))
                await billIfDone(line);
        }
        catch (err) {
            this.logger.warn(`desktop stream aborted for request ${requestId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            try {
                reader.releaseLock();
            }
            catch {
                // Already released by cancellation; nothing to do.
            }
            res.end();
        }
    }
    /** Thinking is reserved for the two top plans, mirroring the shared frontend table. */
    tierAllowsThinking(tier) {
        const t = String(tier || "").toLowerCase();
        return t === "max" || t === "ultimate";
    }
};
exports.DesktopGatewayService = DesktopGatewayService;
exports.DesktopGatewayService = DesktopGatewayService = DesktopGatewayService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [billing_service_1.BillingService,
        addons_service_1.AddonsService])
], DesktopGatewayService);
/**
 * Read a token count out of an upstream usage block.
 *
 * Both spellings are accepted because the AI service has used both, and a rename there must
 * not silently stop billing. Counts are floored at zero: a negative or fractional token
 * count is not something to bill in the customer's favour by accident.
 */
function readUsageBlock(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const block = raw;
    const read = (value) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    };
    return {
        inputTokens: read(block.prompt_tokens ?? block.input_tokens),
        outputTokens: read(block.completion_tokens ?? block.output_tokens),
    };
}
