import { Injectable, BadRequestException, ForbiddenException, HttpException, ServiceUnavailableException } from "@nestjs/common";
import * as crypto from "node:crypto";
import path from "node:path";
import { BillingService } from "../billing/billing.service";
import { AddonsService } from "../billing/addons.service";
import { canUseSpectre } from "../billing/tier-allowance";
import { desktopModelAccess } from "./desktop-policy";

type PreparedContext = {
	name: string; kind: string; text: string; size: number; sourceUrl?: string; warnings: string[];
	usage?: Array<{ modelKey: string; inputTokens: number; outputTokens: number }>;
};
const VISION = "lfm2_5_vl_450m_q4_k_m";
const AUDIO_KEY = "lfm2_5_audio_1_5b_q4_0";

export function modelsForAttachment(name: string): string[] {
	const suffix = path.extname(name).toLowerCase();
	if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".pdf"].includes(suffix)) return [VISION];
	if ([".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus"].includes(suffix)) return [AUDIO_KEY];
	if ([".mp4", ".webm", ".mov", ".mkv", ".avi"].includes(suffix)) return [VISION, AUDIO_KEY];
	return [];
}

@Injectable()
export class PlaygroundContextService {
	constructor(private readonly billing: BillingService, private readonly addons: AddonsService) {}

	async prepareFile(accountId: number, filename: string, data: Buffer, signal?: AbortSignal): Promise<PreparedContext> {
		if (!data.length || data.length > 20 * 1024 * 1024) throw new BadRequestException("Choose a file no larger than 20 MB.");
		const decoded = Buffer.from(filename, "latin1").toString("utf8");
		const original = /^[\u0000-\u00ff]*$/.test(filename) && !decoded.includes("\uFFFD") ? decoded : filename;
		const name = original.replaceAll("\\", "/").split("/").pop()?.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180) || "attachment";
		const models = modelsForAttachment(name);
		const account = await this.authorize(accountId, models);
		const result = await this.process("file", data, { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(name) }, signal,
			(result) => this.settle(result, accountId, account.tier, account.source, models));
		return { ...result, usage: undefined };
	}

	async prepareGithub(accountId: number, url: string, signal?: AbortSignal): Promise<PreparedContext> {
		if (!/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}\/?$/i.test(url.trim()))
			throw new BadRequestException("Enter a GitHub URL such as https://github.com/owner/project.");
		await this.authorize(accountId, []);
		const result = await this.process("github", JSON.stringify({ url: url.trim() }), { "Content-Type": "application/json" }, signal);
		return { ...result, usage: undefined };
	}

	private async authorize(accountId: number, models: string[]) {
		try {
			const tier = await this.billing.resolveTierFor(accountId);
			const access = await this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier));
			if (!access.hasAccess) throw new ForbiddenException({ error: "PLAYGROUND_LOCKED", message: "Sign in with Playground access to attach sources." });
			if (models.length) {
				const [wallet, allowance] = await Promise.all([this.billing.getBalance(accountId), this.billing.getAllowance(accountId, tier)]);
				for (const modelKey of models) {
					if (!desktopModelAccess({ modelKey, tier, accessSource: access.source, walletCanGenerate: wallet.canGenerate, allowanceRemainingRon: allowance.remainingRon }).canGenerate)
						throw new HttpException({ error: "INSUFFICIENT_BALANCE", message: "Your allowance and wallet cannot cover media analysis." }, 402);
				}
			}
			return { tier, source: access.source };
		} catch (error) {
			if (error instanceof HttpException) throw error;
			throw new ServiceUnavailableException({ error: "BILLING_UNAVAILABLE", message: "Your access and balance could not be checked." });
		}
	}

	private async process(kind: "file" | "github", body: Buffer | string, headers: Record<string, string>, signal?: AbortSignal, settle?: (result: PreparedContext) => Promise<void>): Promise<PreparedContext> {
		const controller = new AbortController();
		const abort = () => controller.abort();
		if (signal?.aborted) controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		const timeout = setTimeout(abort, 16 * 60 * 1000);
		try {
			const host = (process.env.PYTHON_AI_HOST || "http://ai:5000").replace(/\/+$/, "");
			const response = await fetch(`${host}/api/playground/context/${kind}`, {
				method: "POST", headers: { ...headers, ...(process.env.AI_SERVICE_KEY ? { "x-ai-service-key": process.env.AI_SERVICE_KEY } : {}) },
				body: typeof body === "string" ? body : new Uint8Array(body), signal: controller.signal,
			});
			const result = await response.json() as PreparedContext & { message?: string };
			// A later video frame can fail after earlier analysis has already used tokens.
			// Settle trusted AI-service usage before returning either success or refusal.
			if (settle) await settle(result);
			if (!response.ok) throw new HttpException({ error: "ATTACHMENT_ERROR", message: result.message || "This source could not be read." }, response.status);
			if (!result.text || result.text.length > 241_000 || !Array.isArray(result.warnings)) throw new Error("Invalid context response");
			return result;
		} catch (error) {
			if (error instanceof HttpException) throw error;
			throw new ServiceUnavailableException({ error: "CONTEXT_UNAVAILABLE", message: "Source processing is unavailable or was cancelled. Please retry." });
		} finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
	}

	private async settle(result: PreparedContext, accountId: number, tier: string, source: "addon" | "tier" | null, allowed: string[]) {
		if (result.usage !== undefined && (!Array.isArray(result.usage) || result.usage.length > 10))
			throw new ServiceUnavailableException("The attachment model returned invalid usage.");
		for (const [index, usage] of (result.usage || []).entries()) {
			if (!allowed.includes(usage.modelKey) || ![usage.inputTokens, usage.outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0))
				throw new ServiceUnavailableException("The attachment model returned invalid usage.");
			await this.billing.recordUsage({ accountId, tier, accessSource: source, modelKey: usage.modelKey,
				usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, scope: "playground", requestId: `attachment-${crypto.randomUUID()}-${index}` });
		}
	}
}
