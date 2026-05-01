import { NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

type PromptScope = "general" | "molecule_helper";

type PromptLimitCheck = {
	allowed: boolean;
	errorResponse?: Response;
	prompts_remaining?: number;
	prompts_limit?: number;
	reset_date?: string;
	tier?: string;
	scope?: PromptScope;
};

type TextModelKey = "minilm_l6_v2_gguf" | "qwen3_06b_q8_0_gguf" | "gemma3_1b_it_q4_0_gguf";

type VisionModelKey = "qwen3_vl_2b_q4_0_gguf";

const PYTHON_CHAT_TIMEOUT_MS = Math.max(30_000, Number.parseInt(process.env.PYTHON_CHAT_TIMEOUT_MS || "330000", 10) || 330_000);

const TEXT_MODEL_NAME_BY_KEY: Record<TextModelKey, string> = {
	minilm_l6_v2_gguf: "MiniLM-L6-v2.gguf",
	qwen3_06b_q8_0_gguf: "Qwen3-0.6B-Q8_0.gguf",
	gemma3_1b_it_q4_0_gguf: "Gemma3-1B-it-Q4_0.gguf",
};

const TEXT_MODEL_TAG_BY_KEY: Record<TextModelKey, string> = {
	minilm_l6_v2_gguf: "MiniLM V2",
	qwen3_06b_q8_0_gguf: "Qwen 3",
	gemma3_1b_it_q4_0_gguf: "Gemma 3",
};

const VISION_MODEL_NAME_BY_KEY: Record<VisionModelKey, string> = {
	qwen3_vl_2b_q4_0_gguf: "Qwen3-VL-2B-Q4_0.gguf",
};

const VISION_MODEL_TAG_BY_KEY: Record<VisionModelKey, string> = {
	qwen3_vl_2b_q4_0_gguf: "Qwen 3 Vision",
};

const ALLOWED_VISION_UPLOAD_MIME_TYPES = new Set([
	"image/webp",
	"image/png",
	"image/avif",
	"image/tiff",
	"image/svg+xml",
	"image/jpeg",
	"image/jpg",
	"image/heic",
]);
const ALLOWED_VISION_UPLOAD_EXTENSIONS = new Set(["webp", "png", "avif", "tif", "tiff", "svg", "jpg", "jpeg", "heic"]);
const DIRECT_PNG_JPEG_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);
const DIRECT_PNG_JPEG_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);
const AUTO_CONVERT_VISION_TIERS = new Set(["pro", "max", "ultimate"]);
const MIN_VISION_DIMENSION_PX = 128;

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

function tierCanAutoConvertVisionImage(tier: string): boolean {
	return AUTO_CONVERT_VISION_TIERS.has(tier);
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
	if (extension) return ALLOWED_VISION_UPLOAD_EXTENSIONS.has(extension);
	if (mime && ALLOWED_VISION_UPLOAD_MIME_TYPES.has(mime)) return true;
	return false;
}

function isDirectPngOrJpegType(mime: string, extension: string): boolean {
	if (mime && DIRECT_PNG_JPEG_MIME_TYPES.has(mime)) return true;
	if (extension && DIRECT_PNG_JPEG_EXTENSIONS.has(extension)) return true;
	return false;
}

function resolveTextModelTag(model: TextModelKey, thinkingEnabled: boolean): string {
	if (model === "qwen3_06b_q8_0_gguf" && thinkingEnabled) {
		return "Qwen 3 Thinking";
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
		return `Image is too small. Minimum size is ${MIN_VISION_DIMENSION_PX}x${MIN_VISION_DIMENSION_PX} pixels.`;
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
	let metadata: sharp.Metadata;
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

	const needsUpscale = width < MIN_VISION_DIMENSION_PX || height < MIN_VISION_DIMENSION_PX;
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
		const scale = Math.max(MIN_VISION_DIMENSION_PX / width, MIN_VISION_DIMENSION_PX / height);
		const targetWidth = Math.max(MIN_VISION_DIMENSION_PX, Math.ceil(width * scale));
		const targetHeight = Math.max(MIN_VISION_DIMENSION_PX, Math.ceil(height * scale));
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

function normalizePromptScope(value: unknown): PromptScope {
	const normalized = String(value || "")
		.trim()
		.toLowerCase();
	return normalized === "molecule_helper" ? "molecule_helper" : "general";
}

function parseOptionalBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") return value;
	if (value === null || value === undefined) return null;
	const normalized = String(value).trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return null;
}

function normalizeTextModelKey(value: unknown): TextModelKey | null {
	const normalized = String(value || "")
		.trim()
		.toLowerCase();
	if (normalized === "qwen3_06b_q8_0_thinking") {
		return "qwen3_06b_q8_0_gguf";
	}
	if (normalized === "minilm_l6_v2_gguf" || normalized === "qwen3_06b_q8_0_gguf" || normalized === "gemma3_1b_it_q4_0_gguf") {
		return normalized as TextModelKey;
	}
	return null;
}

function normalizeVisionModelKey(value: unknown): VisionModelKey | null {
	const normalized = String(value || "")
		.trim()
		.toLowerCase();
	if (normalized === "qwen3_vl_2b_q4_0_gguf") {
		return normalized as VisionModelKey;
	}
	return null;
}

function allowedTextModelsForTier(tier: string): TextModelKey[] {
	if (tier === "ultimate") {
		return ["minilm_l6_v2_gguf", "qwen3_06b_q8_0_gguf", "gemma3_1b_it_q4_0_gguf"];
	}
	if (tier === "max") {
		return ["minilm_l6_v2_gguf", "qwen3_06b_q8_0_gguf"];
	}
	if (tier === "basic" || tier === "plus" || tier === "pro") {
		return ["minilm_l6_v2_gguf", "qwen3_06b_q8_0_gguf"];
	}
	return ["minilm_l6_v2_gguf"];
}

function allowedVisionModelsForTier(tier: string): VisionModelKey[] {
	if (tier === "ultimate") {
		return ["qwen3_vl_2b_q4_0_gguf"];
	}
	if (tier === "basic" || tier === "plus" || tier === "pro" || tier === "max") {
		return ["qwen3_vl_2b_q4_0_gguf"];
	}
	return [];
}

function tierCanUseThinkingModel(tier: string): boolean {
	return tier === "max" || tier === "ultimate";
}

function resolveTextModelKey(tier: string, requested: TextModelKey | null): TextModelKey {
	const allowed = allowedTextModelsForTier(tier);
	if (requested && allowed.includes(requested)) return requested;
	return allowed[0] || "minilm_l6_v2_gguf";
}

function resolveVisionModelKey(tier: string, requested: VisionModelKey | null): VisionModelKey | null {
	const allowed = allowedVisionModelsForTier(tier);
	if (allowed.length === 0) return null;
	if (requested && allowed.includes(requested)) return requested;
	return allowed[0];
}

function slugifyModelName(name: string): string {
	return String(name || "model")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function buildPromptHeaders(request: Request): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	const authHeader = request.headers.get("authorization");
	if (authHeader) headers["authorization"] = authHeader;
	const fingerprint = request.headers.get("x-kafelot-fingerprint");
	if (fingerprint) headers["x-kafelot-fingerprint"] = fingerprint;
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) headers["x-forwarded-for"] = forwarded;
	const scope = request.headers.get("x-kafelot-scope");
	if (scope) headers["x-kafelot-scope"] = scope;
	return headers;
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

async function checkPromptLimit(request: Request, dryRun: boolean, scope: PromptScope): Promise<PromptLimitCheck> {
	try {
		const promptLimitUrl = new URL("/api/kafelot/check-and-use", request.url);
		const headers = buildPromptHeaders(request);

		const callPromptApi = (requestHeaders: Record<string, string>) =>
			fetch(promptLimitUrl, {
				method: "POST",
				headers: requestHeaders,
				body: JSON.stringify({ dry_run: dryRun, scope }),
			});

		const res = await callPromptApi(headers);
		if (res.status === 401 && headers.authorization) {
			return {
				allowed: false,
				errorResponse: new Response(
					JSON.stringify({
						error: "AUTH_SESSION_INVALID",
						message: "Authentication session expired or invalid",
					}),
					{ status: 401, headers: { "Content-Type": "application/json" } },
				),
			};
		}

		if (res.status === 429) {
			const data = (await res.json()) as {
				reset_date?: string;
				prompts_limit?: number;
				prompts_remaining?: number;
				tier?: string;
				scope?: string;
			};
			return {
				allowed: false,
				prompts_remaining: data.prompts_remaining,
				prompts_limit: data.prompts_limit,
				reset_date: data.reset_date,
				tier: normalizeSubscriptionTier(data.tier),
				scope: normalizePromptScope(data.scope || scope),
				errorResponse: new Response(
					JSON.stringify({
						error: "PROMPT_LIMIT_REACHED",
						reset_date: data.reset_date,
						prompts_limit: data.prompts_limit,
						prompts_remaining: data.prompts_remaining,
						tier: data.tier,
						scope: data.scope || scope,
					}),
					{ status: 429, headers: { "Content-Type": "application/json" } },
				),
			};
		}

		if (res.ok) {
			const data = (await res.json()) as {
				prompts_remaining?: number;
				prompts_limit?: number;
				reset_date?: string;
				tier?: string;
				scope?: string;
			};
			return {
				allowed: true,
				prompts_remaining: data.prompts_remaining,
				prompts_limit: data.prompts_limit,
				reset_date: data.reset_date,
				tier: normalizeSubscriptionTier(data.tier),
				scope: normalizePromptScope(data.scope || scope),
			};
		}

		return { allowed: true };
	} catch {
		return { allowed: true };
	}
}

export async function POST(request: Request) {
	try {
		const promptScope = normalizePromptScope(request.headers.get("x-kafelot-scope"));
		const limitCheck = await checkPromptLimit(request, true, promptScope);
		if (!limitCheck.allowed) return limitCheck.errorResponse!;

		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const contentType = request.headers.get("content-type") || "";

		const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

		let pyBody: BodyInit;
		let pyHeaders: Record<string, string> = {};
		let modelType = "tanka_semantic";
		let isImageRequest = false;
		let isChemistryRequest = false;
		let resolvedTier = normalizeSubscriptionTier(limitCheck.tier || "");

		let selectedTextModelKey: TextModelKey = "minilm_l6_v2_gguf";
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
						model_used: "Qwen 3 Vision locked-tier",
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

			effectiveThinking = tierCanUseThinkingModel(resolvedTier) && selectedTextModelKey === "qwen3_06b_q8_0_gguf";
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

			effectiveThinking = tierCanUseThinkingModel(resolvedTier) && selectedTextModelKey === "qwen3_06b_q8_0_gguf";
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
				const fallbackModelTag = isImageRequest ? selectedVisionModelTag || "Qwen 3 Vision" : selectedTextModelTag;
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
				const fallbackModelTag = isImageRequest ? selectedVisionModelTag || "Qwen 3 Vision" : selectedTextModelTag;
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

		const consumed = isChemistryUnavailableFromBackend ? limitCheck : await checkPromptLimit(request, false, promptScope);
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
		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
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
