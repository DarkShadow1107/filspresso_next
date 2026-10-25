import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Logger, Post, Req, Res, ServiceUnavailableException, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { BillingService } from "../billing/billing.service";
import { AddonsService } from "../billing/addons.service";
import { SPECTRE_ADDON_SUMMARY } from "../billing/addons.service";
import { MODEL_TOKEN_PRICING, effectiveRates, resolveTokenPrice } from "../billing/model-pricing";
import { canUseSpectre } from "../billing/tier-allowance";
import { playgroundModelKeys } from "./text-models";
import { DesktopGatewayService } from "./desktop-gateway.service";
import { DesktopInstallerService } from "./desktop-installer.service";
import { DesktopInstallerRegistryService, normalizeAckVersion, normalizeDeviceReport, normalizeOsClaim } from "./desktop-installer-registry.service";
import { desktopModelAccess } from "./desktop-policy";

/** What JwtAuthGuard guarantees on the request it has let through. */
type DesktopRequest = { user?: { id?: number | string } };

/**
 * One call that answers "may I use this, and can I afford it".
 *
 * Why a single endpoint rather than letting the app compose the existing ones. It needs
 * Spectre access, the allowance, the wallet and `canGenerate` before it can render its
 * state, and it needs them again after every completed generation. Calling
 * `/api/spectre/access`, `/api/billing/allowance`, `/api/billing/balance` and
 * `/api/billing/can-generate` separately is four round trips per refresh, each one
 * separately rate limited against a global ceiling of 1200 requests per 15 minutes
 * (constants.ts). On a metered product that is the wrong shape: it spends the user's quota
 * to draw the screen, and it can draw an inconsistent screen if two of the four answers
 * were taken moments apart.
 *
 * Everything below is read from the same services the money gate reads, so what the app is
 * told and what it is charged cannot drift into disagreeing.
 */
@Controller("api/desktop")
@UseGuards(JwtAuthGuard)
export class DesktopController {
	constructor(
		private readonly billing: BillingService,
		private readonly addons: AddonsService,
		private readonly gateway: DesktopGatewayService,
		private readonly installer: DesktopInstallerService,
		private readonly installerRegistry: DesktopInstallerRegistryService,
	) {}

	private readonly logger = new Logger(DesktopController.name);

	/**
	 * Where the desktop app is, and whether this account may have it.
	 *
	 * The account page asks for this so it can show the download without the page
	 * having to know where installers live. The answer is deliberately available to
	 * an account *without* Spectre access: the app is a Spectre feature, but hiding
	 * the fact that it exists from someone who has not subscribed yet is how a
	 * product nobody can find stays that way. What the answer withholds is the
	 * file itself.
	 *
	 * The response now also names the published version and its checksum when the
	 * manifest carries them, because the download popup shows what it is about to hand
	 * over and the installed app later compares this version against its own. `unsigned`
	 * is present and true for the current build on purpose: honesty about the package is
	 * the input to the warning gate, not an error path.
	 */
	@Get("installer")
	async installerInfo(@Req() req: DesktopRequest) {
		const accountId = Number(req.user?.id);
		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
		}
		const tier = await this.billing.resolveTierFor(accountId);
		const access = await this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier));
		const publication = await this.installer.resolve();
		const acknowledged = publication?.version
			? await this.installerRegistry.hasAck(accountId, publication.version)
			: false;

		return {
			available: publication !== null,
			fileName: this.installer.fileName,
			// The button is disabled rather than failing on click, so the reason is on
			// screen before the customer tries.
			canDownload: publication !== null && access.hasAccess,
			downloadUrl: "/api/desktop/download",
			productVersion: publication?.version ?? null,
			sha256: publication?.sha256 ?? null,
			bytes: publication?.bytes ?? null,
			unsigned: publication?.unsigned ?? true,
			// The gate is always required; `acknowledged` says whether this account has
			// already cleared it for the version currently offered.
			acknowledgementRequired: true,
			acknowledged,
		};
	}

	/**
	 * Record the download acknowledgement for the version currently published.
	 *
	 * Two distinct refusals, because they name different remedies. `SPECTRE_REQUIRED` is
	 * "this feature belongs to your subscription"; `VERSION_MISMATCH` is "the version you
	 * confirmed is not the one the server would hand you -- reload the download page and
	 * warn yourself about the version actually being offered". Recording an ack for a
	 * version that cannot be served would authorise a download the site is not offering.
	 */
	@Post("installer/ack")
	@HttpCode(HttpStatus.OK)
	async acknowledgeInstaller(@Req() req: DesktopRequest, @Body() body: Record<string, unknown>) {
		const accountId = Number(req.user?.id);
		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
		}
		const tier = await this.billing.resolveTierFor(accountId);
		const access = await this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier));
		if (!access.hasAccess) {
			throw new ForbiddenException({
				error: "SPECTRE_REQUIRED",
				message: "The desktop app comes with the Spectre Playground subscription.",
			});
		}
		const productVersion = normalizeAckVersion(body?.productVersion);
		const publication = await this.installer.resolve();
		if (!publication?.version || publication.version !== productVersion) {
			throw new ConflictException({
				error: "VERSION_MISMATCH",
				message: "Reload the download page and confirm the version being offered.",
			});
		}
		const osClaim = normalizeOsClaim(body?.operatingSystem);
		await this.installerRegistry.acknowledge(accountId, productVersion, osClaim);
		return { acknowledged: true, productVersion };
	}

	/**
	 * The installer itself.
	 *
	 * Three gates, re-checked here in the order a user experiences failure. Spectre
	 * first: the app is a Spectre feature and the access check is the same one the
	 * client's own entitlement call uses -- a download that does not check would let
	 * anyone who guessed the URL have the app. Then the acknowledgement gate, enforced
	 * against the server-recorded ack rather than the popup's checkbox state, because
	 * the warn-then-acknowledge loop has to survive a scripted client. Version and
	 * integrity are checked inside the installer service, which verifies the served
	 * bytes against their manifest before the first byte moves.
	 */
	@Get("download")
	async download(@Req() req: DesktopRequest, @Res() res: Response) {
		const accountId = Number(req.user?.id);
		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
		}
		const tier = await this.billing.resolveTierFor(accountId);
		const access = await this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier));
		if (!access.hasAccess) {
			throw new ForbiddenException({
				error: "SPECTRE_REQUIRED",
				message: "The desktop app comes with the Spectre Playground subscription.",
			});
		}
		const publication = await this.installer.resolve();
		if (!publication?.version) {
			throw new ServiceUnavailableException({ error: "INSTALLER_UNAVAILABLE" });
		}
		if (!(await this.installerRegistry.hasAck(accountId, publication.version))) {
			throw new ForbiddenException({
				error: "ACKNOWLEDGEMENT_REQUIRED",
				message: "Read and acknowledge the desktop download warnings before the package can be delivered.",
			});
		}
		const result = await this.installer.stream(res);
		// The audit write happens after the headers are committed, so its failure cannot
		// be turned into an HTTP error. It is logged loudly instead of swallowed: a
		// download without a matching ack row would mean the gate above was bypassed,
		// which is a bug worth a log line, never a silent skip.
		try {
			await this.installerRegistry.recordDownload(accountId, result.publication.version ?? "");
		} catch (error) {
			this.logger.error(`Desktop download audit write failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * What the account page says about this account and the desktop app.
	 *
	 * One endpoint for both halves of the answer -- which versions were acknowledged
	 * and how many times they were downloaded, and which machines reported the app --
	 * because they are one question and should not drift apart across two calls.
	 */
	@Get("installations")
	async installations(@Req() req: DesktopRequest) {
		const accountId = Number(req.user?.id);
		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
		}
		return this.installerRegistry.listForAccount(accountId);
	}

	/**
	 * The desktop app's own facts about the machine it runs on.
	 *
	 * The device grant takes the same facts at sign-in; this route lets a running app
	 * refresh its report when they change (a Windows update moves the build, a new app
	 * release moves the version) without waiting for the next re-login. Values are
	 * normalised by the registry: anything implausible is stored as "unknown", never
	 * as a plausible lie. This is client-reported information and is therefore display
	 * data on the account page, never an entitlement input.
	 */
	@Post("device-state")
	@HttpCode(HttpStatus.OK)
	async deviceState(@Req() req: DesktopRequest, @Body() body: Record<string, unknown>) {
		const accountId = Number(req.user?.id);
		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
		}
		const report = normalizeDeviceReport(body ?? {});
		await this.installerRegistry.reportDeviceState(accountId, report);
		return { recorded: true };
	}

	/**
	 * Stream a generation, metered.
	 *
	 * The single route the desktop client needs for inference, and the reason Phase 0 could
	 * not be skipped: before it, the only way to reach a model from outside a browser was the
	 * AI service on port 5000, which authenticates nobody and meters nothing.
	 *
	 * Every refusal is answered before the response is committed to a stream. Once headers
	 * are on the wire the status code is fixed, so the gate cannot be expressed as "start
	 * streaming and then report the error" -- a client would have to invent a second error
	 * channel inside a success response.
	 */
	@Post("chat/stream")
	async chatStream(@Req() req: DesktopRequest, @Res() res: Response, @Body() body: Record<string, unknown>) {
		const accountId = Number(req.user?.id);
		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
		}
		const tier = await this.billing.resolveTierFor(accountId);

		const result = await this.gateway.streamChat(res, accountId, tier, body ?? {});
		if (result.kind === "refused") {
			// Not yet committed: the gate runs before any header is written, so this is a
			// normal JSON error response and the client can branch on the status.
			res.status(result.status).json({ error: result.error, message: result.message });
			return;
		}
		// `sent` means the socket is already owned by the gateway, which has ended the
		// response. Writing anything here would corrupt the stream.
	}

	/**
	 * The app's single source of truth for entitlement and affordability.
	 *
	 * `canGenerate` is included rather than left to the app to derive from the allowance and
	 * the balance, because the derivation has a subtlety: `canGenerate` is true when *either*
	 * pot can pay. An account with no allowance left and a funded wallet may generate, and an
	 * app that checked `remainingRon > 0` alone would lock paying customers out of a
	 * Playground they can use.
	 */
	@Get("entitlement")
	async entitlement(@Req() req: DesktopRequest) {
		const accountId = Number(req.user?.id);
		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new UnauthorizedException({ error: "ACCOUNT_REQUIRED" });
		}

		// Fail closed. If the account state cannot be read, the client is told the service is
		// unavailable -- not that the account is locked and not that it is broke. Those are
		// different messages pointing at different remedies, and answering "locked" to a
		// billing outage would send a paying customer to subscribe again.
		try {
			return await this.entitlementFor(accountId);
		} catch {
			throw new ServiceUnavailableException({ error: "BILLING_UNAVAILABLE" });
		}
	}

	private async entitlementFor(accountId: number) {
		const tier = await this.billing.resolveTierFor(accountId);

		// The allowance is a separate view from the wallet, so it is a separate query. They
		// run concurrently, and they are the same two reads the money gate already performs,
		// so this is not extra load -- it is the same load, answered once instead of twice.
		const [access, balance, allowance] = await Promise.all([
			this.addons.resolveSpectreAccess(accountId, tier, canUseSpectre(tier)),
			this.billing.getBalance(accountId),
			this.billing.getAllowance(accountId, tier),
		]);
		const models = this.modelCatalogue(access.source, tier, balance.canGenerate, allowance.remainingRon);

		return {
			accountId,
			tier,
			access: {
				hasAccess: access.hasAccess,
				source: access.source,
				expiresAt: access.expiresAt,
				autoRenew: access.autoRenew,
				canFundWallet: access.canFundWallet,
			},
			// `tierGrantsAccess` is reported separately from `access.source` on purpose. They
			// usually agree, but they answer different questions: one is "does my plan
			// include this", the other is "who is paying for my usage". The app needs both --
			// the first to decide whether to offer the subscription at all, the second to
			// explain where a message is being charged from.
			tierGrantsAccess: canUseSpectre(tier),
			allowance,
			wallet: {
				balanceRon: balance.balanceRon,
				canGenerate: balance.canGenerate,
				minBalanceRon: balance.minBalanceRon,
				minBalanceIsCustom: balance.minBalanceIsCustom,
				autoRefill: balance.autoRefill,
			},
			canGenerate: models.some((model) => model.canGenerate),
			// The subscription terms, so the app can render an upsell without a second call.
			// Prices are what the account would actually pay, from the same source the charge
			// path uses, so the upsell cannot quote a number the checkout would then change.
			subscription: {
				monthlyRon: SPECTRE_ADDON_SUMMARY.monthlyRon,
				annualRon: SPECTRE_ADDON_SUMMARY.annualRon,
				includesUsage: SPECTRE_ADDON_SUMMARY.includesUsage,
			},
			models,
			attachmentModels: ["lfm2_5_vl_450m_q4_k_m", "lfm2_5_audio_1_5b_q4_0"].map((modelKey) => {
				const price = resolveTokenPrice(modelKey, "playground");
				return { modelKey, label: price.label, ...effectiveRates(price) };
			}),
			// The app polls this after every generation. Stamped so it can tell a fresh answer
			// from a cached one without trusting its own clock against the server's.
			servedAt: new Date().toISOString(),
		};
	}

	/**
	 * Every selectable model, including Vision and Audio recommendations for imported media,
	 * with the price this account would pay and whether it may run it.
	 *
	 * Locked models are listed rather than omitted, with their price attached. The app needs
	 * to show what exists and what it would cost, and a hidden model cannot do either.
	 */
	private modelCatalogue(
		accessSource: "addon" | "tier" | null,
		tier: string,
		walletCanGenerate: boolean,
		allowanceRemainingRon: number,
	) {
		return playgroundModelKeys()
			.filter((modelKey) => modelKey in MODEL_TOKEN_PRICING)
			.map((modelKey) => {
				const price = resolveTokenPrice(modelKey, "playground");
				const rates = effectiveRates(price);
				// A model the account cannot afford is still listed: the app shows the price and
				// the lock, which is the same thing the web line-up does. `canGenerate` is a
				// hint for the UI, never a gate -- the gateway re-checks on every request,
				// because a balance read at render time says nothing about the balance at
				// send time.
				return {
					modelKey,
					// The display name. Without it the client shows the raw key -- lfm2_5_230m_q4_k_m --
					// which is a storage identifier, not a product name. It comes from the same
					// resolved price the numbers do, so the label and the price cannot disagree
					// about which model this is.
					label: price.label,
					inputPer1M: rates.inputPer1M,
					outputPer1M: rates.outputPer1M,
					priceMode: price.priceMode,
					...desktopModelAccess({
						modelKey,
						tier,
						accessSource,
						walletCanGenerate,
						allowanceRemainingRon,
					}),
				};
			});
	}
}
