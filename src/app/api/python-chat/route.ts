import { NextResponse } from "next/server";
import sharp from "sharp";
import { resolveAiHost } from "@/lib/server/aiHost";
import {
	ALLOWED_VISION_UPLOAD_EXTENSIONS,
	ALLOWED_VISION_UPLOAD_MIME_TYPES,
	DIRECT_UPLOAD_EXTENSIONS,
	DIRECT_UPLOAD_MIME_TYPES,
	VISION_MIN_SHORT_EDGE_PX,
	tierCanAutoConvertVisionImage,
	tierCanUseMoleculeHelper,
} from "@/lib/entitlements";
import {
	allowedTextModelsForTier as sharedAllowedTextModels,
	allowedVisionModelsForTier as sharedAllowedVisionModels,
	defaultModelForTier,
	TEXT_MODEL_230M,
	TEXT_MODEL_2_6B,
	TEXT_MODEL_1_2B_THINKING,
	VISION_MODEL_450M,
	MODEL_FILE_BY_KEY,
	isTextModelKey,
	isVisionModelKey,
	MODEL_LABEL_BY_KEY,
	normalizeModelTier,
	tierCanUseThinkingModel as sharedTierCanUseThinking,
	type TextModelKey,
	type VisionModelKey,
} from "@/lib/modelAccess";
import {
	checkPromptLimit,
	normalizePromptScope,
	type PromptLimitCheck,
	type PromptScope,
} from "@/lib/server/promptLimits";
import { readUsageBlock, reportUsage } from "@/lib/server/billing/reportUsage";
import { getOrCreateFingerprint } from "@/lib/fingerprint";

type SharpMetadata = Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;

export const runtime = "nodejs";

const PYTHON_CHAT_TIMEOUT_MS = Math.max(30_000, Number.parseInt(process.env.PYTHON_CHAT_TIMEOUT_MS || "330000", 10) || 330_000);

// GGUF file names and display tags come from the canonical table in
// @/lib/modelAccess. They used to be duplicated here, which is how this route
// kept serving a Gemma 3 GGUF long after the model was retired.
const TEXT_MODEL_NAME_BY_KEY = MODEL_FILE_BY_KEY as Record<TextModelKey, string>;
const TEXT_MODEL_TAG_BY_KEY = MODEL_LABEL_BY_KEY as Record<TextModelKey, string>;
const VISION_MODEL_NAME_BY_KEY = MODEL_FILE_BY_KEY as Record<VisionModelKey, string>;
const VISION_MODEL_TAG_BY_KEY = MODEL_LABEL_BY_KEY as Record<VisionModelKey, string>;


type VisionImageNormalizationResult = {
	file: File;
	autoConverted: boolean;
	upscaled: boolean;
};

function normalizeSubscriptionTier(value: unknown): string {
	return String(value || "")
		.trim()
		.toLowerCase();
}

function normalizeImageMime(value: unknown): string {
	const normalized = String(value || "")
		.trim()
		.toLowerCase();
	if (normalized === "image/jpg") return "image/jpeg";
	return normalized;
}

function extractFileExtension(name: string): string {
	const match = /\.([a-z0-9]+)$/i.exec(name || "");
	return match ? match[1].toLowerCase() : "";
}

function isAllowedVisionUploadType(mime: string, extension: string): boolean {
	if (extension) return ALLOWED_VISION_UPLOAD_EXTENSIONS.includes(extension);
	if (mime && ALLOWED_VISION_UPLOAD_MIME_TYPES.includes(mime)) return true;
	return false;
}

function isDirectPngOrJpegType(mime: string, extension: string): boolean {
	if (mime && DIRECT_UPLOAD_MIME_TYPES.includes(mime)) return true;
	if (extension && DIRECT_UPLOAD_EXTENSIONS.includes(extension)) return true;
	return false;
}

/** Models that emit visible reasoning. Thinking is its own GGUF, not a flag. */
function thinkingCapable(model: TextModelKey): boolean {
	return model === TEXT_MODEL_1_2B_THINKING || model === TEXT_MODEL_2_6B;
}

function resolveTextModelTag(model: TextModelKey, thinkingEnabled: boolean): string {
	if (model === TEXT_MODEL_1_2B_THINKING) {
		return "LFM 2.5 Thinking";
	}
	if (model === TEXT_MODEL_2_6B && thinkingEnabled) {
		return "LFM 2.5 2.6B Thinking";
	}
	return TEXT_MODEL_TAG_BY_KEY[model] || "Kafelot text model";
}

function buildInvalidImageResponse(requestId: string, message: string, limitCheck: PromptLimitCheck, status: number) {
	return NextResponse.json(
		{
			error: "IMAGE_UPLOAD_INVALID",
			message,
			request_id: requestId,
			...(typeof limitCheck.prompts_remaining === "number" ? { prompts_remaining: limitCheck.prompts_remaining } : {}),
			...(typeof limitCheck.prompts_limit === "number" ? { prompts_limit: limitCheck.prompts_limit } : {}),
			...(limitCheck.tier ? { subscription_tier: limitCheck.tier } : {}),
			...(limitCheck.scope ? { prompts_scope: limitCheck.scope } : {}),
		},
		{ status },
	);
}

function imageValidationMessage(code: string): string {
	if (code === "FILE_NOT_IMAGE") {
		return "Only image files can be uploaded.";
	}
	if (code === "UNSUPPORTED_IMAGE_FORMAT") {
		return "Unsupported image format. Allowed formats: WEBP, PNG, AVIF, TIFF, SVG, JPG, JPEG, HEIC.";
	}
	if (code === "FORMAT_NOT_ALLOWED") {
		return "BASIC and PLUS support PNG/JPG uploads only. PRO, MAX, and ULTIMATE auto-convert supported image formats to JPG.";
	}
	if (code === "IMAGE_TOO_SMALL") {
		return `Image is too small. Minimum size is ${VISION_MIN_SHORT_EDGE_PX}x${VISION_MIN_SHORT_EDGE_PX} pixels.`;
	}
	if (code === "IMAGE_DECODE_FAILED") {
		return "The uploaded image could not be decoded. Please upload a valid WEBP, PNG, AVIF, TIFF, SVG, JPG, JPEG, or HEIC image.";
	}
	return "Invalid image upload.";
}

async function normalizeVisionUploadForTier(image: File, tier: string): Promise<VisionImageNormalizationResult> {
	const mime = normalizeImageMime(image.type);
	const extension = extractFileExtension(image.name);
	if (!isAllowedVisionUploadType(mime, extension)) {
		throw new Error("UNSUPPORTED_IMAGE_FORMAT");
	}

	const canAutoConvert = tierCanAutoConvertVisionImage(tier);
	const isDirectPngJpeg = isDirectPngOrJpegType(mime, extension);
	if (!canAutoConvert && !isDirectPngJpeg) {
		throw new Error("FORMAT_NOT_ALLOWED");
	}

	const sourceBuffer = Buffer.from(await image.arrayBuffer());
	let metadata: SharpMetadata;
	try {
		metadata = await sharp(sourceBuffer, { failOn: "none", limitInputPixels: false }).metadata();
	} catch {
		throw new Error("IMAGE_DECODE_FAILED");
	}

	const width = Number(metadata.width || 0);
	const height = Number(metadata.height || 0);
	if (!width || !height) {
		throw new Error("IMAGE_DECODE_FAILED");
	}

	const needsUpscale = width < VISION_MIN_SHORT_EDGE_PX || height < VISION_MIN_SHORT_EDGE_PX;
	if (needsUpscale && !canAutoConvert) {
		throw new Error("IMAGE_TOO_SMALL");
	}

	if (!canAutoConvert) {
		return {
			file: image,
			autoConverted: false,
			upscaled: false,
		};
	}

	const shouldConvertToJpeg = !isDirectPngJpeg;
	if (!shouldConvertToJpeg && !needsUpscale) {
		return {
			file: image,
			autoConverted: false,
			upscaled: false,
		};
	}

	let transform = sharp(sourceBuffer, { failOn: "none", limitInputPixels: false });
	if (needsUpscale) {
		const scale = Math.max(VISION_MIN_SHORT_EDGE_PX / width, VISION_MIN_SHORT_EDGE_PX / height);
		const targetWidth = Math.max(VISION_MIN_SHORT_EDGE_PX, Math.ceil(width * scale));
		const targetHeight = Math.max(VISION_MIN_SHORT_EDGE_PX, Math.ceil(height * scale));
		transform = transform.resize(targetWidth, targetHeight, {
			fit: "fill",
			kernel: "lanczos3",
			withoutEnlargement: false,
		});
	}

	let outputBuffer: Buffer;
	let outputMime = "image/jpeg";
	let outputExtension = "jpg";
	try {
		if (shouldConvertToJpeg) {
			outputBuffer = await transform.flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
			outputMime = "image/jpeg";
			outputExtension = "jpg";
		} else if (mime === "image/png" || extension === "png") {
			outputBuffer = await transform.png({ compressionLevel: 9 }).toBuffer();
			outputMime = "image/png";
			outputExtension = "png";
		} else {
			outputBuffer = await transform.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
			outputMime = "image/jpeg";
			outputExtension = "jpg";
		}
	} catch {
		throw new Error("IMAGE_DECODE_FAILED");
	}

	const baseName = image.name.replace(/\.[^.]+$/, "").trim() || "upload";
	const normalizedBytes = new Uint8Array(outputBuffer);
	const normalizedFile = new File([normalizedBytes], `${baseName}.${outputExtension}`, { type: outputMime });

	return {
		file: normalizedFile,
		autoConverted: shouldConvertToJpeg,
		upscaled: needsUpscale,
	};
}

function parseOptionalBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") return value;
	if (value === null || value === undefined) return null;
	const normalized = String(value).trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return null;
}

// Legacy keys are still accepted so in-flight clients (and any cached UI state)
// keep resolving to a real model instead of silently falling back to MiniLM.
const LEGACY_TEXT_MODEL_ALIASES: Record<string, TextModelKey> = {
	qwen3_06b_q8_0_gguf: TEXT_MODEL_2_6B,
	qwen3_06b_q8_0_thinking: TEXT_MODEL_2_6B,
};

const LEGACY_VISION_MODEL_ALIASES: Record<string, VisionModelKey> = {
	qwen3_vl_2b_q4_0_gguf: VISION_MODEL_450M,
};

/**
 * Resolve whatever the client sent into a canonical model key.
 *
 * This used to accept only a hand-maintained legacy alias table, which meant the
 * two things callers actually send -- the canonical key (`lfm2_5_8b_a1b_q4_k_m`, what
 * CoffeeRecommender sends) and the GGUF file name (`LFM2.5-8B-A1B-Q4_K_M.gguf`,
 * what /api/playground/chat sends) -- both resolved to `null`. The route then fell
 * back to the cheapest allowed model, so a user who picked the 8B silently got the
 * 230M, and per-model metering charged the wrong model.
 *
 * Order matters: canonical keys win, then file names, then the legacy aliases.
 */
function normalizeTextModelKey(value: unknown): TextModelKey | null {
	const normalized = String(value || "")
		.trim()
		.toLowerCase();
	if (!normalized) return null;

	if (isTextModelKey(normalized)) return normalized;

	const byFile = TEXT_MODEL_KEY_SET_BY_FILE.get(normalized);
	if (byFile) return byFile;

	const legacy = LEGACY_TEXT_MODEL_ALIASES[normalized];
	if (legacy) return legacy;

	if (normalized === "minilm_l6_v2_gguf" || normalized === "lfm2_5_2_6b_q4_0_gguf" || normalized === "gemma3_1b_it_q4_0_gguf") {
		return normalized as TextModelKey;
	}
	return null;
}

function normalizeVisionModelKey(value: unknown): VisionModelKey | null {
	const normalized = String(value || "")
		.trim()
		.toLowerCase();
	if (!normalized) return null;

	if (isVisionModelKey(normalized)) return normalized;

	const byFile = VISION_MODEL_KEY_SET_BY_FILE.get(normalized);
	if (byFile) return byFile;

	const legacy = LEGACY_VISION_MODEL_ALIASES[normalized];
	if (legacy) return legacy;

	if (normalized === "lfm2_vl_450m_q4_0_gguf") {
		return normalized as VisionModelKey;
	}
	return null;
}

/**
 * Lowercased GGUF file name -> canonical key.
 *
 * Built from `MODEL_FILE_BY_KEY` so a rename in one place cannot desync the route.
 */
const TEXT_MODEL_KEY_SET_BY_FILE: Map<string, TextModelKey> = new Map(
	(Object.entries(MODEL_FILE_BY_KEY) as Array<[string, string]>)
		.filter(([key]) => key !== "minilm_l6_v2_gguf")
		.map(([key, file]) => [file.trim().toLowerCase(), key as TextModelKey]),
);

const VISION_MODEL_KEY_SET_BY_FILE: Map<string, VisionModelKey> = new Map(
	(Object.entries(MODEL_FILE_BY_KEY) as Array<[string, string]>)
		.filter(([key]) => key === "lfm2_5_vl_450m_q4_k_m" || key === "lfm2_5_vl_3b_q4_k_m")
		.map(([key, file]) => [file.trim().toLowerCase(), key as VisionModelKey]),
);

/** Tier -> model tables live in @/lib/modelAccess so this route, the prewarm
 *  route, and the Kafelot UI cannot drift apart. */
function allowedTextModelsForTier(tier: string): TextModelKey[] {
	return sharedAllowedTextModels(normalizeModelTier(tier));
}

function allowedVisionModelsForTier(tier: string): VisionModelKey[] {
	return sharedAllowedVisionModels(normalizeModelTier(tier));
}

function tierCanUseThinkingModel(tier: string): boolean {
	return sharedTierCanUseThinking(normalizeModelTier(tier));
}

function resolveTextModelKey(tier: string, requested: TextModelKey | null): TextModelKey {
	const allowed = allowedTextModelsForTier(tier);
	if (requested && allowed.includes(requested)) return requested;
	// Fall back to the cheapest model the plan actually includes rather than a
	// hardcoded key, which would silently select a model the tier cannot use.
	return allowed[0] ?? (defaultModelForTier(normalizeModelTier(tier)) as TextModelKey);
}

function resolveVisionModelKey(tier: string, requested: VisionModelKey | null): VisionModelKey | null {
	const allowed = allowedVisionModelsForTier(tier);
	if (allowed.length === 0) return null;
	if (requested && allowed.includes(requested)) return requested;
	return allowed[0];
}

function chemistryUnavailablePayload(isImageRequest: boolean, requestId: string, limitCheck: PromptLimitCheck, modelTag: string) {
	const message = isImageRequest
		? `${modelTag} runtime is in high demand right now, we're sorry for unavailability.`
		: `${modelTag} runtime is in high demand right now, we're sorry for unavailability.`;

	const modelUsed = isImageRequest ? `${modelTag} unavailable high-demand` : `${modelTag} unavailable high-demand`;

	return NextResponse.json(
		{
			response: message,
			products: [],
			smarterAI: true,
			model: "Kafelot",
			model_used: modelUsed,
			mode: "Chemistry",
			request_id: requestId,
			...(typeof limitCheck.prompts_remaining === "number" ? { prompts_remaining: limitCheck.prompts_remaining } : {}),
			...(typeof limitCheck.prompts_limit === "number" ? { prompts_limit: limitCheck.prompts_limit } : {}),
			...(limitCheck.tier ? { subscription_tier: limitCheck.tier } : {}),
			...(limitCheck.scope ? { prompts_scope: limitCheck.scope } : {}),
		},
		{ status: 200 },
	);
}

export async function POST(request: Request) {
	try {
		// Provisional: replaced below by a scope derived from the resolved mode.
		let promptScope: PromptScope = normalizePromptScope(request.headers.get("x-kafelot-scope"));
		const limitCheck = await checkPromptLimit(request, true, promptScope);
		if (!limitCheck.allowed) return limitCheck.errorResponse!;

		const PY_HOST = await resolveAiHost();
		const contentType = request.headers.get("content-type") || "";

		const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

		let pyBody: BodyInit;
		let pyHeaders: Record<string, string> = {};
		let modelType = "tanka_semantic";
		let isImageRequest = false;
		let isChemistryRequest = false;
		let resolvedTier = normalizeSubscriptionTier(limitCheck.tier || "");

		let selectedTextModelKey: TextModelKey = TEXT_MODEL_230M;
		let selectedVisionModelKey: VisionModelKey | null = null;
		let selectedTextModelName = TEXT_MODEL_NAME_BY_KEY[selectedTextModelKey];
		let selectedTextModelTag = TEXT_MODEL_TAG_BY_KEY[selectedTextModelKey];
		let selectedVisionModelName = "";
		let selectedVisionModelTag = "";
		let effectiveThinking = false;

		if (contentType.includes("multipart/form-data")) {
			const formData = await request.formData();
			const imagePart = formData.get("image");
			const image = imagePart instanceof File ? imagePart : null;
			isImageRequest = Boolean(image);
			const messagesRaw = formData.get("messages") as string;
			const messages = messagesRaw ? (JSON.parse(messagesRaw) as Array<Record<string, string>>) : [];
			let normalizedImage: File | null = null;

			const requestTier = normalizeSubscriptionTier(formData.get("subscription"));
			resolvedTier = normalizeSubscriptionTier(limitCheck.tier || requestTier);

			modelType = (formData.get("model") as string) || "tanka_semantic";
			const mode = modelType === "tanka_chemistry" ? "chemistry" : "natural_language";
			isChemistryRequest = mode === "chemistry";
			const reqId = (formData.get("request_id") as string) || requestId;

			const requestedTextModel = normalizeTextModelKey(formData.get("text_model"));
			selectedTextModelKey = resolveTextModelKey(resolvedTier, requestedTextModel);
			selectedTextModelName = TEXT_MODEL_NAME_BY_KEY[selectedTextModelKey];
			selectedTextModelTag = TEXT_MODEL_TAG_BY_KEY[selectedTextModelKey];

			const requestedVisionModel = normalizeVisionModelKey(formData.get("vision_model"));
			selectedVisionModelKey = resolveVisionModelKey(resolvedTier, requestedVisionModel);
			selectedVisionModelName = selectedVisionModelKey ? VISION_MODEL_NAME_BY_KEY[selectedVisionModelKey] : "";
			selectedVisionModelTag = selectedVisionModelKey ? VISION_MODEL_TAG_BY_KEY[selectedVisionModelKey] : "";

			if (isImageRequest && !selectedVisionModelKey) {
				return NextResponse.json(
					{
						error: "VISION_MODEL_LOCKED",
						message: "Vision upload is available for BASIC, PLUS, PRO, MAX, and ULTIMATE subscriptions.",
						model_used: "LFM 2 Vision locked-tier",
						request_id: reqId,
						...(typeof limitCheck.prompts_remaining === "number"
							? { prompts_remaining: limitCheck.prompts_remaining }
							: {}),
						...(typeof limitCheck.prompts_limit === "number" ? { prompts_limit: limitCheck.prompts_limit } : {}),
						...(limitCheck.tier ? { subscription_tier: limitCheck.tier } : {}),
						...(limitCheck.scope ? { prompts_scope: limitCheck.scope } : {}),
					},
					{ status: 403 },
				);
			}

			if (imagePart && !(imagePart instanceof File)) {
				return buildInvalidImageResponse(reqId, imageValidationMessage("FILE_NOT_IMAGE"), limitCheck, 415);
			}

			if (image) {
				try {
					const normalized = await normalizeVisionUploadForTier(image, resolvedTier);
					normalizedImage = normalized.file;
				} catch (error) {
					const code = error instanceof Error ? error.message : "IMAGE_UPLOAD_INVALID";
					const status =
						code === "FILE_NOT_IMAGE" || code === "FORMAT_NOT_ALLOWED" || code === "UNSUPPORTED_IMAGE_FORMAT"
							? 415
							: 400;
					return buildInvalidImageResponse(reqId, imageValidationMessage(code), limitCheck, status);
				}
			}

			effectiveThinking = tierCanUseThinkingModel(resolvedTier) && thinkingCapable(selectedTextModelKey);
			if (parseOptionalBoolean(formData.get("enable_thinking")) === false) {
				effectiveThinking = false;
			}
			selectedTextModelTag = resolveTextModelTag(selectedTextModelKey, effectiveThinking);

			const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
			const queryMessage = lastUserMsg?.content || messages[messages.length - 1]?.content || "";

			const pyForm = new FormData();
			pyForm.append("message", queryMessage);
			pyForm.append("mode", mode);
			pyForm.append("request_id", reqId);
			pyForm.append("text_model", selectedTextModelName);
			pyForm.append("enable_thinking", String(effectiveThinking));
			if (selectedVisionModelName) {
				pyForm.append("vision_model", selectedVisionModelName);
			}
			if (normalizedImage) pyForm.append("image", normalizedImage);

			pyBody = pyForm;
		} else {
			const body = (await request.json()) as Record<string, unknown>;
			modelType = (body.model as string) || "tanka_semantic";
			const mode = modelType === "tanka_chemistry" ? "chemistry" : "natural_language";
			isChemistryRequest = mode === "chemistry";
			const reqId = (body.request_id as string) || requestId;

			const requestTier = normalizeSubscriptionTier(body.subscription);
			resolvedTier = normalizeSubscriptionTier(limitCheck.tier || requestTier);

			const requestedTextModel = normalizeTextModelKey(body.text_model);
			selectedTextModelKey = resolveTextModelKey(resolvedTier, requestedTextModel);
			selectedTextModelName = TEXT_MODEL_NAME_BY_KEY[selectedTextModelKey];
			selectedTextModelTag = TEXT_MODEL_TAG_BY_KEY[selectedTextModelKey];

			const requestedVisionModel = normalizeVisionModelKey(body.vision_model);
			selectedVisionModelKey = resolveVisionModelKey(resolvedTier, requestedVisionModel);
			selectedVisionModelName = selectedVisionModelKey ? VISION_MODEL_NAME_BY_KEY[selectedVisionModelKey] : "";
			selectedVisionModelTag = selectedVisionModelKey ? VISION_MODEL_TAG_BY_KEY[selectedVisionModelKey] : "";

			effectiveThinking = tierCanUseThinkingModel(resolvedTier) && thinkingCapable(selectedTextModelKey);
			if (parseOptionalBoolean(body.enable_thinking) === false) {
				effectiveThinking = false;
			}
			selectedTextModelTag = resolveTextModelTag(selectedTextModelKey, effectiveThinking);

			pyHeaders = { "Content-Type": "application/json" };
			const msgList = (body.messages as Array<Record<string, string>>) || [];
			const lastUserContent =
				[...msgList].reverse().find((m) => m.role === "user")?.content || msgList[msgList.length - 1]?.content || "";

			const pyPayload: Record<string, unknown> = {
				message: lastUserContent,
				mode,
				request_id: reqId,
				text_model: selectedTextModelName,
				enable_thinking: effectiveThinking,
			};
			if (selectedVisionModelName) {
				pyPayload.vision_model = selectedVisionModelName;
			}
			pyBody = JSON.stringify(pyPayload);
		}

		// ---- Chemistry / Molecule Helper entitlement ----
		//
		// Molecule Helper is an ULTIMATE feature. This is enforced here, after the
		// tier is resolved, because `limitCheck.tier` comes from the limiter and
		// therefore already wins over anything the client claimed in `subscription`.
		//
		// Previously there was no gate at all: `mode` was derived from the client's
		// `model` field and `kafelot.service.ts` grants the 200-prompt molecule bucket
		// to *every* tier, so text chemistry worked for anonymous and free callers.
		if (isChemistryRequest && !tierCanUseMoleculeHelper(resolvedTier)) {
			return NextResponse.json(
				{
					error: "CHEMISTRY_LOCKED",
					message: "Molecule Helper is available on the ULTIMATE plan.",
				},
				{ status: 403, headers: { "Cache-Control": "no-store" } },
			);
		}

		// The metered bucket must follow the mode, not the client-supplied header.
		// They were independent: a crafted request could charge `molecule_helper`
		// while sending a normal chat, or `general` while running chemistry. The
		// header is only honoured when it agrees with the resolved mode.
		const effectiveScope: PromptScope = isChemistryRequest
			? "molecule_helper"
			: "general";
		promptScope = effectiveScope;

		// ---- Per-model metering ----
		//
		// The plan total alone cannot express what the plans page advertises: an
		// ULTIMATE user has 1000 general prompts but only 120 on the 8B model, so the
		// 8B has to run out first. The vision model is metered when the request uses
		// one, otherwise the text model is.
		const meteredModelKey = isImageRequest && selectedVisionModelKey ? selectedVisionModelKey : selectedTextModelKey;

		// The dry-run at the top of this handler ran before the model was resolved, so
		// it checked the header-derived scope with no model key. Re-check now that both
		// the scope and the model are known, before anything is consumed.
		const scoped = await checkPromptLimit(request, true, promptScope, meteredModelKey);
		if (!scoped.allowed) return scoped.errorResponse!;
		limitCheck.tier = scoped.tier;
		limitCheck.model_key = scoped.model_key;
		limitCheck.model_prompts_remaining = scoped.model_prompts_remaining;

		const pythonAbortController = new AbortController();
		const timeout = setTimeout(() => pythonAbortController.abort(), PYTHON_CHAT_TIMEOUT_MS);
		let res: Response;
		try {
			res = await fetch(`${PY_HOST}/api/chat`, {
				method: "POST",
				headers: pyHeaders,
				body: pyBody,
				signal: pythonAbortController.signal,
			});
		} catch (error) {
			if (isChemistryRequest) {
				const fallbackModelTag = isImageRequest ? selectedVisionModelTag || "LFM 2 Vision" : selectedTextModelTag;
				return chemistryUnavailablePayload(isImageRequest, requestId, limitCheck, fallbackModelTag);
			}
			if (
				error instanceof Error &&
				(error.name === "AbortError" || /timed out|timeout|headers?timeout/i.test(error.message || ""))
			) {
				return NextResponse.json(
					{
						error: "PYTHON_AI_TIMEOUT",
						message: "Python AI request timed out before completing.",
					},
					{ status: 504 },
				);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}

		if (!res.ok) {
			const text = await res.text();
			let errorMsg = `Python AI error: ${res.status}`;
			try {
				const errorJson = JSON.parse(text);
				errorMsg = errorJson.error || errorMsg;
			} catch {
				// Keep status message when upstream response is not JSON.
			}

			if (
				isChemistryRequest &&
				(res.status >= 500 ||
					/fetch failed|timed out|timeout|unavailable|connection|mmproj/i.test(errorMsg.toLowerCase()))
			) {
				const fallbackModelTag = isImageRequest ? selectedVisionModelTag || "LFM 2 Vision" : selectedTextModelTag;
				return chemistryUnavailablePayload(isImageRequest, requestId, limitCheck, fallbackModelTag);
			}

			return NextResponse.json({ error: errorMsg }, { status: res.status });
		}

		const json = (await res.json()) as Record<string, unknown>;
		const modelUsed = String(json.model_used || "");
		const backendUnavailableModel = modelUsed.toLowerCase();
		const isChemistryUnavailableFromBackend =
			isChemistryRequest &&
			backendUnavailableModel.includes("unavailable") &&
			(backendUnavailableModel.includes("high-demand") || backendUnavailableModel.includes("missing-mmproj"));

		if (json.cancelled) {
			return NextResponse.json({ cancelled: true, request_id: requestId }, { status: 200 });
		}

		// Bill the generation, now that we know what it cost. This is the step that makes
		// the price table, the allowance and the balance move; without it they are all
		// correct and permanently zero.
		//
		// Not awaited on the response path: the answer is already produced and the customer
		// is waiting. The requestId makes a late retry idempotent.
		const usage = readUsageBlock(json.usage);
		if (usage) {
			void reportUsage(request, {
				modelKey: meteredModelKey,
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				requestId,
				fingerprint: getOrCreateFingerprint(),
			}).catch(() => null);
		}

		const consumed = isChemistryUnavailableFromBackend ? limitCheck : await checkPromptLimit(request, false, promptScope, meteredModelKey);
		const promptsRemaining =
			typeof consumed.prompts_remaining === "number"
				? consumed.prompts_remaining
				: typeof limitCheck.prompts_remaining === "number"
					? limitCheck.prompts_remaining
					: undefined;
		const promptsLimit =
			typeof consumed.prompts_limit === "number"
				? consumed.prompts_limit
				: typeof limitCheck.prompts_limit === "number"
					? limitCheck.prompts_limit
					: undefined;

		return NextResponse.json(
			{
				response: (json.assistant_response as string) || (json.generated as string) || "",
				products: (json.products as unknown[]) || [],
				smarterAI: true,
				model: "Kafelot",
				model_used: (json.model_used as string) || "Kafelot",
				mode: (json.mode as string) || "",
				thinking_mode: (json.thinking_mode as string) || "",
				request_id: requestId,
				text_model: selectedTextModelName,
				text_model_tag: selectedTextModelTag,
				...(selectedVisionModelName ? { vision_model: selectedVisionModelName } : {}),
				...(selectedVisionModelTag ? { vision_model_tag: selectedVisionModelTag } : {}),
				...(typeof promptsRemaining === "number" ? { prompts_remaining: promptsRemaining } : {}),
				...(typeof promptsLimit === "number" ? { prompts_limit: promptsLimit } : {}),
				...(consumed.tier
					? { subscription_tier: consumed.tier }
					: limitCheck.tier
						? { subscription_tier: limitCheck.tier }
						: {}),
				...(consumed.scope
					? { prompts_scope: consumed.scope }
					: limitCheck.scope
						? { prompts_scope: limitCheck.scope }
						: {}),
			},
			{ status: res.status },
		);
	} catch (err) {
		const rawError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		const isTimeoutLike = /aborterror|timed out|timeout|headers?timeout/i.test(rawError.toLowerCase());
		return NextResponse.json(
			{
				error: isTimeoutLike ? "PYTHON_AI_TIMEOUT" : rawError,
				message: isTimeoutLike ? "Python AI request timed out before completing." : rawError,
			},
			{ status: isTimeoutLike ? 504 : 502 },
		);
	}
}

export async function DELETE(request: Request) {
	try {
		const PY_HOST = await resolveAiHost();
		const { searchParams } = new URL(request.url);
		const requestId = searchParams.get("request_id");

		if (!requestId) {
			return NextResponse.json({ error: "request_id is required" }, { status: 400 });
		}

		const res = await fetch(`${PY_HOST}/api/cancel/${requestId}`, {
			method: "POST",
		});
		const json = await res.json();

		return NextResponse.json(json, { status: res.status });
	} catch (err) {
		return NextResponse.json({ error: String(err) }, { status: 502 });
	}
}
