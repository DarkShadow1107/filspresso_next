"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import useCart from "@/hooks/useCart";
import type { CoffeeProduct } from "@/data/coffee";
import { useCoffeeCollections } from "@/hooks/useCoffeeCollections";
import { readSnapshot } from "@/lib/clientSnapshotCache";
import { useNotifications } from "@/components/NotificationsProvider";
import AddCapsulesPopup from "@/components/AddCapsulesPopup";
import { smartSearchMolecule, isMoleculeQuery, extractMoleculeQuery } from "@/lib/moleculeSearch";
import { clearAccountSession, readAccountSession } from "@/lib/accountSession";
import KafelotStats from "./kafelot/KafelotStats";
import KafelotUsage from "./kafelot/KafelotUsage";
import {
	LockIcon,
	TrashIcon,
	ChartBarIcon,
	ClockIcon,
	HistoryCircleIcon,
	GithubCopilotIcon,
	SparklesIcon,
	FlameIcon,
	MessageCircleIcon,
	MagnifierIcon,
	BulbSvg,
	RocketIcon,
	VinylIcon,
	FileDescriptionIcon,
	RefreshIcon,
	InfoCircleIcon,
	ArrowNarrowDownIcon,
	ShoppingCartIcon,
	CoffeeIcon,
	BrandGrokIcon,
	BrandOllamaIcon,
	BrandAnthropicIcon,
	BrandGeminiIcon,
	BrandQwenIcon,
	XIcon,
	CameraIcon,
	SendHorizontalIcon,
	PenIcon,
} from "@/icons";

// Parse **bold** and *italic* markdown in chat messages
function formatMarkdown(text: string): React.ReactNode[] {
	const parts: React.ReactNode[] = [];
	// Match **bold** or *italic* patterns
	const regex = /\*\*(.+?)\*\*|\*([^*]+?)\*/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			parts.push(text.slice(lastIndex, match.index));
		}
		if (match[1] !== undefined) {
			parts.push(<em key={match.index}>{match[1]}</em>);
		} else if (match[2] !== undefined) {
			parts.push(<em key={match.index}>{match[2]}</em>);
		}
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}
	return parts;
}

// Memoize product flattening for performance
function useAllProducts(): CoffeeProduct[] {
	const { collections } = useCoffeeCollections();
	return collections?.flatMap((c) => c.groups.flatMap((g) => g.products)) ?? [];
}

// Stock data type
type StockData = Record<string, { price: number; stock: number; stockStatus?: "in_stock" | "low_stock" | "out_of_stock" }>;

type CapsuleVariant = "original" | "vertuo";

const buildVariantStockKey = (productId: string, variant: CapsuleVariant) => `${productId}::${variant}`;

const detectVariantFromImageOrId = (image?: string | null, productId?: string | null): CapsuleVariant => {
	const img = (image || "").toLowerCase();
	const pid = (productId || "").toLowerCase();
	if (img.includes("/vertuo/") || /-(vertuo|vl)$/.test(pid)) return "vertuo";
	return "original";
};

const getVariantStock = (stockData: StockData, productId: string, image?: string | null, forcedVariant?: CapsuleVariant) => {
	const variant = forcedVariant || detectVariantFromImageOrId(image, productId);
	const baseId = productId.replace(/-(original|vertuo|vl)$/i, "");
	return (
		stockData[buildVariantStockKey(productId, variant)] ||
		stockData[buildVariantStockKey(baseId, variant)] ||
		stockData[buildVariantStockKey(`${baseId}-${variant === "vertuo" ? "vertuo" : "original"}`, variant)] ||
		stockData[buildVariantStockKey(`${baseId}-vl`, variant)]
	);
};

type MoleculeMessageView = {
	chembl_id?: string;
	name?: string;
	smiles?: string;
	molecular_formula?: string;
	molecular_weight?: number;
	svg?: string;
	sdf?: string;
	[key: string]: unknown;
};

type Message = {
	role: "user" | "assistant";
	content: string;
	products?: CoffeeProduct[];
	image?: string;
	images?: string[];
	modelUsed?: string;
	molecule?: MoleculeMessageView;
};

type StylizedModelInfo = {
	label: string;
	accent: "qwen" | "minilm" | "clip";
};

type TextModelKey = "minilm_l6_v2_gguf" | "qwen3_06b_q8_0_gguf" | "gemma3_1b_it_q4_0_gguf";

type VisionModelKey = "qwen3_vl_2b_q4_0_gguf";

type ModelUsageKey = "minilm" | "qwen3" | "gemma3" | "qwen3Vision" | "other";

const TEXT_MODEL_LABEL_BY_KEY: Record<TextModelKey, string> = {
	minilm_l6_v2_gguf: "MiniLM V2",
	qwen3_06b_q8_0_gguf: "Qwen 3",
	gemma3_1b_it_q4_0_gguf: "Gemma 3",
};

const VISION_MODEL_LABEL_BY_KEY: Record<VisionModelKey, string> = {
	qwen3_vl_2b_q4_0_gguf: "Qwen 3 Vision",
};

const MODEL_USAGE_LABEL_BY_KEY: Record<ModelUsageKey, string> = {
	minilm: "MiniLM V2",
	qwen3: "Qwen 3",
	gemma3: "Gemma 3",
	qwen3Vision: "Qwen 3 Vision",
	other: "Other / Fallback",
};

function detectModelUsageKey(rawModel?: string): ModelUsageKey {
	const normalized = String(rawModel || "")
		.trim()
		.toLowerCase();

	if (!normalized) return "other";
	if (normalized.includes("vision")) return "qwen3Vision";
	if (normalized.includes("gemma")) return "gemma3";
	if (normalized.includes("qwen")) return "qwen3";
	if (normalized.includes("minilm")) return "minilm";
	return "other";
}

function isHighDemandUnavailableModel(rawModel?: string): boolean {
	const normalized = String(rawModel || "")
		.trim()
		.toLowerCase();
	if (!normalized) return false;
	return normalized.includes("unavailable") && normalized.includes("high-demand");
}

function getStylizedModelInfo(rawModel?: string): StylizedModelInfo {
	const source = String(rawModel || "").trim();
	const normalized = source.toLowerCase();

	if (normalized.includes("qwen 3 thinking")) {
		return {
			label: normalized.includes("unavailable") ? "Qwen 3 Thinking (Unavailable)" : "Qwen 3 Thinking",
			accent: "qwen",
		};
	}
	if (normalized.includes("qwen 3 vision")) {
		return { label: normalized.includes("unavailable") ? "Qwen 3 Vision (Unavailable)" : "Qwen 3 Vision", accent: "clip" };
	}
	if (normalized.includes("gemma 3")) {
		return { label: normalized.includes("unavailable") ? "Gemma 3 (Unavailable)" : "Gemma 3", accent: "qwen" };
	}
	if (normalized.includes("qwen 3")) {
		return { label: normalized.includes("unavailable") ? "Qwen 3 (Unavailable)" : "Qwen 3", accent: "qwen" };
	}
	if (normalized.includes("minilm v2")) {
		return { label: normalized.includes("fallback") ? "MiniLM V2 (Fallback)" : "MiniLM V2", accent: "minilm" };
	}

	if (normalized.includes("qwen3-vl-2b-q4_0.gguf")) {
		return { label: "Qwen 3 Vision", accent: "clip" };
	}
	if (normalized.includes("locked-tier") && normalized.includes("vision")) {
		return { label: "Qwen 3 Vision (Locked)", accent: "clip" };
	}
	if (normalized.includes("vision-unavailable") || (normalized.includes("vision") && normalized.includes("unavailable"))) {
		return { label: "Qwen 3 Vision (Unavailable)", accent: "clip" };
	}
	if (normalized.includes("gemma3-1b-it-q4_0.gguf")) {
		return { label: "Gemma 3", accent: "qwen" };
	}
	if (normalized.includes("qwen3-0.6b-q8_0.gguf") && normalized.includes("thinking")) {
		return { label: "Qwen 3 Thinking", accent: "qwen" };
	}
	if (normalized.includes("qwen3-0.6b-q8_0.gguf")) {
		return { label: "Qwen 3", accent: "qwen" };
	}
	if (normalized.includes("minilm-l6-v2.gguf")) {
		if (normalized.includes("fallback")) {
			return { label: "MiniLM V2 (Fallback)", accent: "minilm" };
		}
		return { label: "MiniLM V2", accent: "minilm" };
	}
	if (normalized.includes("clip") || normalized.includes("vision")) {
		return { label: "Qwen 3 Vision", accent: "clip" };
	}
	if (normalized.includes("qwen3") && normalized.includes("unavailable")) {
		return { label: "Qwen 3 (Unavailable)", accent: "qwen" };
	}
	if (normalized.includes("gemma") && normalized.includes("unavailable")) {
		return { label: "Gemma 3 (Unavailable)", accent: "qwen" };
	}
	if (normalized.includes("llama.cpp") && normalized.includes("unavailable")) {
		return { label: "llama.cpp (Unavailable)", accent: "qwen" };
	}
	if (normalized.includes("qwen3") && normalized.includes("unauthorized")) {
		return { label: "Qwen 3 (Locked)", accent: "qwen" };
	}
	if (normalized.includes("llama.cpp") && normalized.includes("unauthorized")) {
		return { label: "llama.cpp (Locked)", accent: "qwen" };
	}
	if (normalized.includes("qwen3-local") && normalized.includes("thinking")) {
		return { label: "Qwen 3 Thinking", accent: "qwen" };
	}
	if (normalized.includes("llama.cpp-local") && normalized.includes("thinking")) {
		return { label: "llama.cpp Thinking", accent: "qwen" };
	}
	if (normalized.includes("qwen3")) {
		return { label: "Qwen 3", accent: "qwen" };
	}
	if (normalized.includes("llama.cpp")) {
		return { label: "llama.cpp", accent: "qwen" };
	}
	if (normalized.includes("minilm")) {
		if (normalized.includes("fallback")) {
			return { label: "MiniLM V2 (Fallback)", accent: "minilm" };
		}
		return { label: "MiniLM V2", accent: "minilm" };
	}

	return { label: "Kafelot", accent: "minilm" };
}

type ChatHistory = {
	id: string;
	timestamp: number;
	messages: Message[];
	preview: string;
	model: TextModelKey;
	category: "coffee" | "chemistry" | "general";
};

type HelperMode = "coffee_helper" | "molecule_helper";
type HelperConversationSnapshot = {
	chatId: string | null;
	messages: Message[];
};

type PromptScope = "general" | "molecule_helper";

type PromptScopeState = {
	promptsRemaining: number | null;
	promptsLimit: number | null;
	resetDate: string | null;
};

type PromptScopeStats = {
	scopeLabel: string;
	used: number;
	remaining: number;
	limit: number;
	usagePercent: number;
	resetDate: string | null;
};

type UserSubscriptionTier = "none" | "free" | "basic" | "plus" | "pro" | "max" | "ultimate";

const KNOWN_SUBSCRIPTION_TIERS = new Set<UserSubscriptionTier>(["none", "free", "basic", "plus", "pro", "max", "ultimate"]);

const TEXT_MODELS_BY_TIER: Record<UserSubscriptionTier, TextModelKey[]> = {
	none: ["minilm_l6_v2_gguf"],
	free: ["minilm_l6_v2_gguf"],
	basic: ["minilm_l6_v2_gguf", "qwen3_06b_q8_0_gguf"],
	plus: ["minilm_l6_v2_gguf", "qwen3_06b_q8_0_gguf"],
	pro: ["minilm_l6_v2_gguf", "qwen3_06b_q8_0_gguf"],
	max: ["minilm_l6_v2_gguf", "qwen3_06b_q8_0_gguf"],
	ultimate: ["minilm_l6_v2_gguf", "qwen3_06b_q8_0_gguf", "gemma3_1b_it_q4_0_gguf"],
};

const VISION_MODELS_BY_TIER: Record<UserSubscriptionTier, VisionModelKey[]> = {
	none: [],
	free: [],
	basic: ["qwen3_vl_2b_q4_0_gguf"],
	plus: ["qwen3_vl_2b_q4_0_gguf"],
	pro: ["qwen3_vl_2b_q4_0_gguf"],
	max: ["qwen3_vl_2b_q4_0_gguf"],
	ultimate: ["qwen3_vl_2b_q4_0_gguf"],
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
const DIRECT_VISION_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);
const DIRECT_VISION_UPLOAD_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);
const AUTO_CONVERT_VISION_TIERS = new Set<UserSubscriptionTier>(["pro", "max", "ultimate"]);
const MIN_VISION_IMAGE_DIMENSION_PX = 128;
const PREMIUM_COFFEE_HELPER_IMAGE_LIMIT = 3;

function canAutoConvertVisionUpload(tier: UserSubscriptionTier): boolean {
	return AUTO_CONVERT_VISION_TIERS.has(tier);
}

function coffeeHelperImageLimitForTier(tier: UserSubscriptionTier): number {
	return tier === "max" || tier === "ultimate" ? PREMIUM_COFFEE_HELPER_IMAGE_LIMIT : 1;
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
	if (mime && DIRECT_VISION_UPLOAD_MIME_TYPES.has(mime)) return true;
	if (extension && DIRECT_VISION_UPLOAD_EXTENSIONS.has(extension)) return true;
	return false;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const objectUrl = URL.createObjectURL(file);
		const probe = document.createElement("img");

		probe.onload = () => {
			const width = probe.naturalWidth || probe.width;
			const height = probe.naturalHeight || probe.height;
			URL.revokeObjectURL(objectUrl);
			resolve({ width, height });
		};

		probe.onerror = () => {
			URL.revokeObjectURL(objectUrl);
			reject(new Error("IMAGE_DECODE_FAILED"));
		};

		probe.src = objectUrl;
	});
}

async function convertVisionUploadToJpegPreview(file: File, minDimensionPx: number): Promise<File> {
	const objectUrl = URL.createObjectURL(file);
	try {
		const imageElement = await new Promise<HTMLImageElement>((resolve, reject) => {
			const probe = document.createElement("img");
			probe.onload = () => resolve(probe);
			probe.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
			probe.src = objectUrl;
		});

		const width = imageElement.naturalWidth || imageElement.width;
		const height = imageElement.naturalHeight || imageElement.height;
		if (!width || !height) {
			throw new Error("IMAGE_DECODE_FAILED");
		}

		const scale = Math.max(1, minDimensionPx / width, minDimensionPx / height);
		const targetWidth = Math.max(minDimensionPx, Math.ceil(width * scale));
		const targetHeight = Math.max(minDimensionPx, Math.ceil(height * scale));

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("CANVAS_CONTEXT_UNAVAILABLE");
		}

		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, targetWidth, targetHeight);
		context.drawImage(imageElement, 0, 0, targetWidth, targetHeight);

		const jpegBlob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/jpeg", 0.9);
		});
		if (!jpegBlob) {
			throw new Error("JPEG_PREVIEW_CONVERSION_FAILED");
		}

		const baseName = file.name.replace(/\.[^.]+$/, "").trim() || "upload";
		return new File([jpegBlob], `${baseName}.jpg`, { type: "image/jpeg" });
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

async function combinePromptImagesAsJpeg(files: File[]): Promise<File> {
	if (files.length === 1) {
		return files[0];
	}

	const loadedImages = await Promise.all(
		files.map(async (file) => {
			const objectUrl = URL.createObjectURL(file);
			try {
				const imageElement = await new Promise<HTMLImageElement>((resolve, reject) => {
					const probe = document.createElement("img");
					probe.onload = () => resolve(probe);
					probe.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
					probe.src = objectUrl;
				});

				const width = imageElement.naturalWidth || imageElement.width;
				const height = imageElement.naturalHeight || imageElement.height;
				if (!width || !height) {
					throw new Error("IMAGE_DECODE_FAILED");
				}

				return { imageElement, width, height, cleanup: () => URL.revokeObjectURL(objectUrl) };
			} catch (error) {
				URL.revokeObjectURL(objectUrl);
				throw error;
			}
		}),
	);

	try {
		const maxWidth = 1024;
		const gap = 12;
		const scaledEntries = loadedImages.map((entry) => {
			const scale = Math.min(1, maxWidth / entry.width);
			return {
				...entry,
				targetWidth: Math.max(1, Math.round(entry.width * scale)),
				targetHeight: Math.max(1, Math.round(entry.height * scale)),
			};
		});

		const canvas = document.createElement("canvas");
		canvas.width = Math.max(...scaledEntries.map((entry) => entry.targetWidth));
		canvas.height =
			scaledEntries.reduce((sum, entry) => sum + entry.targetHeight, 0) + Math.max(0, scaledEntries.length - 1) * gap;

		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("CANVAS_CONTEXT_UNAVAILABLE");
		}

		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, canvas.width, canvas.height);

		let offsetY = 0;
		for (const entry of scaledEntries) {
			const offsetX = Math.floor((canvas.width - entry.targetWidth) / 2);
			context.drawImage(entry.imageElement, offsetX, offsetY, entry.targetWidth, entry.targetHeight);
			offsetY += entry.targetHeight + gap;
		}

		const jpegBlob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/jpeg", 0.9);
		});
		if (!jpegBlob) {
			throw new Error("IMAGE_COLLAGE_FAILED");
		}

		return new File([jpegBlob], `coffee-helper-multi-${Date.now()}.jpg`, { type: "image/jpeg" });
	} finally {
		for (const entry of loadedImages) {
			entry.cleanup();
		}
	}
}

async function validateVisionUploadCandidate(
	file: File,
	tier: UserSubscriptionTier,
): Promise<{ ok: true } | { ok: false; message: string }> {
	const mime = normalizeImageMime(file.type);
	const extension = extractFileExtension(file.name);

	if (!isAllowedVisionUploadType(mime, extension)) {
		return {
			ok: false,
			message: "Unsupported file type. Allowed: WEBP, PNG, AVIF, TIFF, SVG, JPG, JPEG, HEIC.",
		};
	}

	const autoConvertAllowed = canAutoConvertVisionUpload(tier);
	if (!autoConvertAllowed && !isDirectPngOrJpegType(mime, extension)) {
		return {
			ok: false,
			message:
				"BASIC and PLUS allow PNG/JPG only. PRO, MAX, and ULTIMATE include auto-convert to JPG for additional image formats.",
		};
	}

	if (!autoConvertAllowed) {
		let dimensions: { width: number; height: number };
		try {
			dimensions = await readImageDimensions(file);
		} catch {
			return {
				ok: false,
				message: "Could not read this image. Please upload a valid PNG or JPG file.",
			};
		}

		if (dimensions.width < MIN_VISION_IMAGE_DIMENSION_PX || dimensions.height < MIN_VISION_IMAGE_DIMENSION_PX) {
			return {
				ok: false,
				message: `Image is too small. Minimum supported size is ${MIN_VISION_IMAGE_DIMENSION_PX}x${MIN_VISION_IMAGE_DIMENSION_PX}px.`,
			};
		}
	}

	return { ok: true };
}

const GENERAL_PROMPT_LIMIT_BY_TIER: Record<UserSubscriptionTier, number> = {
	none: 15,
	free: 15,
	basic: 50,
	plus: 100,
	pro: 150,
	max: 300,
	ultimate: 1000,
};

const MOLECULE_PROMPT_LIMIT_BY_TIER: Record<UserSubscriptionTier, number> = {
	none: 200,
	free: 200,
	basic: 200,
	plus: 200,
	pro: 200,
	max: 200,
	ultimate: 200,
};

const CHAT_MEMORY_LIMIT_BY_TIER: Record<UserSubscriptionTier, number> = {
	none: 5,
	free: 5,
	basic: 20,
	plus: 50,
	pro: 100,
	max: 200,
	ultimate: 200,
};

function expectedPromptLimit(tier: UserSubscriptionTier, scope: PromptScope, loggedIn: boolean): number {
	if (!loggedIn) {
		return scope === "molecule_helper" ? 25 : 25;
	}
	return scope === "molecule_helper" ? MOLECULE_PROMPT_LIMIT_BY_TIER[tier] : GENERAL_PROMPT_LIMIT_BY_TIER[tier];
}

function normalizePromptCounters(
	inputRemaining: unknown,
	inputLimit: unknown,
	tier: UserSubscriptionTier,
	loggedIn: boolean,
	scope: PromptScope,
): { promptsRemaining: number; promptsLimit: number } {
	const expectedLimitValue = expectedPromptLimit(tier, scope, loggedIn);
	const incomingLimit = Number(inputLimit);
	const hasReasonableIncomingLimit =
		Number.isFinite(incomingLimit) && incomingLimit > 0 && incomingLimit <= expectedLimitValue * 3;
	const promptsLimit = hasReasonableIncomingLimit ? incomingLimit : expectedLimitValue;

	const incomingRemaining = Number(inputRemaining);
	const promptsRemaining = Number.isFinite(incomingRemaining)
		? Math.max(0, Math.min(incomingRemaining, promptsLimit))
		: promptsLimit;

	return { promptsRemaining, promptsLimit };
}

function normalizeUserSubscriptionTier(rawTier: unknown, fallback: UserSubscriptionTier = "none"): UserSubscriptionTier {
	const normalized = typeof rawTier === "string" ? rawTier.trim().toLowerCase() : "";
	if (!normalized) return fallback;
	if (normalized === "none") return "free";
	if (KNOWN_SUBSCRIPTION_TIERS.has(normalized as UserSubscriptionTier)) {
		return normalized as UserSubscriptionTier;
	}
	return fallback;
}

function shouldEnableThinkingForPrompt(prompt: string, hasThinkingAccess: boolean, toggleEnabled: boolean): boolean {
	if (!hasThinkingAccess) return false;
	const hasThinkDirective = /(?:^|\s)\/think(?:\s|$)/i.test(prompt || "");
	const hasNoThinkDirective = /(?:^|\s)\/no_think(?:\s|$)/i.test(prompt || "");
	if (hasNoThinkDirective) return false;
	if (hasThinkDirective) return true;
	return toggleEnabled;
}

const STORAGE_KEY = "coffee-recommender-history";
const POPULAR_PRODUCTS_CACHE_KEY = "filspresso_popular_products_cache";
const POPULAR_PRODUCTS_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_HISTORY = 50; // Increased history limit
let lastSavedHistoryPayload = "";

function loadChatHistory(): ChatHistory[] {
	// Chat history is now loaded from the server, not localStorage
	return [];
}

async function saveChatHistory(history: ChatHistory[]) {
	if (typeof window === "undefined") return;
	const payload = JSON.stringify({ history });
	if (payload === lastSavedHistoryPayload) return;
	try {
		// Save to server only
		const response = await fetch("/api/chat/save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: payload,
		});
		if (!response.ok) {
			throw new Error(`Failed to save chat history: ${response.status}`);
		}
		lastSavedHistoryPayload = payload;
	} catch (e) {
		console.error("Failed to save chat history", e);
	}
}

export default React.memo(function CoffeeRecommender() {
	const allProducts = useAllProducts();
	const allProductsById = useMemo(() => new Map(allProducts.map((product) => [product.id, product])), [allProducts]);
	const [mounted, setMounted] = useState(false);
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<"greeting" | "prefs" | "results" | "chat" | "history" | "stats">("greeting");
	const [selected, setSelected] = useState<string[]>([]);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<CoffeeProduct[]>([]);
	const [smartText, setSmartText] = useState("");
	const [intensity, setIntensity] = useState<number>(7);
	const [intensityEnabled, setIntensityEnabled] = useState(false);
	const [flavorGroups, setFlavorGroups] = useState<string[]>([]);
	const [collectionFilter, setCollectionFilter] = useState<"all" | "original" | "vertuo">("all");
	const [popupOpen, setPopupOpen] = useState(false);
	const [selectedProduct, setSelectedProduct] = useState<CoffeeProduct | null>(null);
	const [chatMessages, setChatMessages] = useState<Message[]>([]);
	const [chatInput, setChatInput] = useState("");
	const [currentChatId, setCurrentChatId] = useState<string | null>(null);
	const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
	const helperConversationsRef = useRef<Record<HelperMode, HelperConversationSnapshot>>({
		coffee_helper: { chatId: null, messages: [] },
		molecule_helper: { chatId: null, messages: [] },
	});
	const [chatMode, setChatMode] = useState<"coffee" | "general">("coffee");
	const [selectedModel, setSelectedModel] = useState<TextModelKey>("minilm_l6_v2_gguf");
	const [selectedVisionModel, setSelectedVisionModel] = useState<VisionModelKey>("qwen3_vl_2b_q4_0_gguf");
	const [chemistryMode, setChemistryMode] = useState(false);
	const [thinkingEnabledByHelper, setThinkingEnabledByHelper] = useState<Record<HelperMode, boolean>>({
		coffee_helper: false,
		molecule_helper: false,
	});
	const [visualizationMode, setVisualizationMode] = useState<"text" | "2d" | "3d" | "both">("both");
	const [mediaLightbox, setMediaLightbox] = useState<{ type: "image" | "html"; src: string; title?: string } | null>(null);
	const [smarterAIAvailable, setSmarterAIAvailable] = useState(false);
	const [isLoggedIn, setIsLoggedIn] = useState(false); // User login state
	const [userSubscription, setUserSubscription] = useState<UserSubscriptionTier>("free");
	const [isTyping, setIsTyping] = useState(false);
	const abortControllerRef = useRef<AbortController | null>(null);
	const currentRequestIdRef = useRef<string | null>(null);
	const submitCooldownRef = useRef<number>(0);
	const moleculeVizCacheRef = useRef<Record<string, { molecule: Record<string, unknown>; svg?: string; sdf?: string }>>({});
	const [chatImages, setChatImages] = useState<File[]>([]);

	// Prompt limit tracking
	const [promptsRemaining, setPromptsRemaining] = useState<number | null>(null);
	const [promptsLimit, setPromptsLimit] = useState<number | null>(null);
	const [promptResetDate, setPromptResetDate] = useState<string | null>(null);
	const [promptUsageByScope, setPromptUsageByScope] = useState<Record<PromptScope, PromptScopeState>>({
		general: {
			promptsRemaining: null,
			promptsLimit: null,
			resetDate: null,
		},
		molecule_helper: {
			promptsRemaining: null,
			promptsLimit: null,
			resetDate: null,
		},
	});
	const [limitReached, setLimitReached] = useState(false);
	const fingerprintRef = useRef<string>("");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const recommenderRef = useRef<HTMLDivElement>(null);
	const editingMessageIdxRef = useRef<number | null>(null);
	const lastSavedConversationSignatureRef = useRef<string>("");
	const [editingMessageIdx, setEditingMessageIdx] = useState<number | null>(null);
	const { addItem } = useCart({ passive: true });
	const { notify } = useNotifications();

	// Stock data for products
	const [stockData, setStockData] = useState<StockData>({});

	const allNotes = useMemo(() => {
		const set = new Set<string>();
		allProducts.forEach((p) => p.notes?.forEach((n) => set.add(n)));
		return Array.from(set).sort();
	}, [allProducts]);
	const activeHelperMode: HelperMode = chemistryMode ? "molecule_helper" : "coffee_helper";
	const activePromptScope: PromptScope = chemistryMode ? "molecule_helper" : "general";
	const activePromptScopeRef = useRef<PromptScope>(activePromptScope);

	useEffect(() => {
		activePromptScopeRef.current = activePromptScope;
	}, [activePromptScope]);

	const updatePromptScopeState = useCallback(
		(scope: PromptScope, counters: { promptsRemaining: number; promptsLimit: number }, resetDate?: string | null) => {
			setPromptUsageByScope((prev) => ({
				...prev,
				[scope]: {
					promptsRemaining: counters.promptsRemaining,
					promptsLimit: counters.promptsLimit,
					resetDate: resetDate === undefined ? prev[scope].resetDate : resetDate,
				},
			}));
		},
		[],
	);

	const stats = useMemo(() => {
		const categoryCounts = { coffee: 0, chemistry: 0, general: 0 };
		const modelPromptCounts: Record<ModelUsageKey, number> = {
			minilm: 0,
			qwen3: 0,
			gemma3: 0,
			qwen3Vision: 0,
			other: 0,
		};

		let totalAssistantResponses = 0;

		chatHistory.forEach((chat) => {
			if (chat.category) categoryCounts[chat.category]++;
			else categoryCounts.general++;

			chat.messages.forEach((message) => {
				if (message.role !== "assistant") return;
				totalAssistantResponses++;
				const usageKey = detectModelUsageKey(message.modelUsed);
				modelPromptCounts[usageKey] += 1;
			});
		});

		const modelPromptPercentages = (Object.keys(modelPromptCounts) as ModelUsageKey[]).reduce(
			(acc, key) => {
				acc[key] =
					totalAssistantResponses > 0
						? Math.round((modelPromptCounts[key] / totalAssistantResponses) * 10000) / 100
						: 0;
				return acc;
			},
			{ minilm: 0, qwen3: 0, gemma3: 0, qwen3Vision: 0, other: 0 } as Record<ModelUsageKey, number>,
		);

		const buildPromptScopeStats = (scope: PromptScope): PromptScopeStats => {
			const scopeCounters = promptUsageByScope[scope];
			const computedPromptsLimit =
				Number.isFinite(scopeCounters.promptsLimit) && Number(scopeCounters.promptsLimit) > 0
					? Number(scopeCounters.promptsLimit)
					: expectedPromptLimit(userSubscription, scope, isLoggedIn);
			const computedPromptsRemaining =
				scopeCounters.promptsRemaining !== null
					? Math.max(0, Math.min(scopeCounters.promptsRemaining, computedPromptsLimit))
					: computedPromptsLimit;
			const promptsUsed = Math.max(0, computedPromptsLimit - computedPromptsRemaining);
			const promptsUsagePercent =
				computedPromptsLimit > 0 ? Math.round((promptsUsed / computedPromptsLimit) * 10000) / 100 : 0;

			return {
				scopeLabel: scope === "molecule_helper" ? "Molecule Helper" : "General",
				used: promptsUsed,
				remaining: computedPromptsRemaining,
				limit: computedPromptsLimit,
				usagePercent: promptsUsagePercent,
				resetDate: scopeCounters.resetDate,
			};
		};

		const hasMoleculeHelperAccess = (VISION_MODELS_BY_TIER[userSubscription] || []).length > 0;

		const memoryLimit = CHAT_MEMORY_LIMIT_BY_TIER[userSubscription] ?? MAX_HISTORY;
		const memoryUsed = chatHistory.length;
		const memoryRemaining = Math.max(0, memoryLimit - memoryUsed);
		const memoryUsagePercent = memoryLimit > 0 ? Math.min(100, Math.round((memoryUsed / memoryLimit) * 10000) / 100) : 0;

		return {
			categoryCounts,
			totalConversations: chatHistory.length,
			modelPromptUsage: {
				labels: MODEL_USAGE_LABEL_BY_KEY,
				counts: modelPromptCounts,
				percentages: modelPromptPercentages,
				totalResponses: totalAssistantResponses,
			},
			prompts: {
				general: buildPromptScopeStats("general"),
				moleculeHelper: hasMoleculeHelperAccess ? buildPromptScopeStats("molecule_helper") : null,
			},
			memory: {
				used: memoryUsed,
				remaining: memoryRemaining,
				limit: memoryLimit,
				usagePercent: memoryUsagePercent,
			},
		};
	}, [chatHistory, promptUsageByScope, userSubscription, isLoggedIn]);

	const allowedTextModels = useMemo(() => TEXT_MODELS_BY_TIER[userSubscription] || ["minilm_l6_v2_gguf"], [userSubscription]);
	const allowedVisionModels = useMemo(() => VISION_MODELS_BY_TIER[userSubscription] || [], [userSubscription]);
	const hasVisionAccess = allowedVisionModels.length > 0;
	const hasQwenAccess = useMemo(() => allowedTextModels.includes("qwen3_06b_q8_0_gguf"), [allowedTextModels]);
	const hasQwenThinkingAccess = useMemo(
		() => userSubscription === "max" || userSubscription === "ultimate",
		[userSubscription],
	);
	const hasGemmaAccess = useMemo(() => allowedTextModels.includes("gemma3_1b_it_q4_0_gguf"), [allowedTextModels]);
	const hasVisionAutoConvert = useMemo(() => canAutoConvertVisionUpload(userSubscription), [userSubscription]);
	const maxImagesPerPrompt = useMemo(
		() => (chemistryMode ? 1 : coffeeHelperImageLimitForTier(userSubscription)),
		[chemistryMode, userSubscription],
	);
	const supportsMultiImagePrompt = maxImagesPerPrompt > 1;
	const visionUploadPolicyHint = useMemo(() => {
		if (!hasVisionAccess) return "Vision upload is locked on Free tier.";
		if (hasVisionAutoConvert) {
			const multiImageHint = supportsMultiImagePrompt
				? ` Coffee Helper supports up to ${maxImagesPerPrompt} images per prompt on ${userSubscription.toUpperCase()}.`
				: "";
			return `Allowed: WEBP, PNG, AVIF, TIFF, SVG, JPG, JPEG, HEIC. PRO, MAX, and ULTIMATE auto-convert non-PNG/JPG uploads to JPG and upscale small images to at least ${MIN_VISION_IMAGE_DIMENSION_PX}px.${multiImageHint}`;
		}
		return `BASIC and PLUS accept PNG/JPG only, minimum ${MIN_VISION_IMAGE_DIMENSION_PX}x${MIN_VISION_IMAGE_DIMENSION_PX}px.`;
	}, [hasVisionAccess, hasVisionAutoConvert, maxImagesPerPrompt, supportsMultiImagePrompt, userSubscription]);
	const thinkingEnabledForActiveHelper = thinkingEnabledByHelper[activeHelperMode];

	const subscriptionTierLabel = useMemo(() => {
		if (!isLoggedIn) return "Guest";
		if (userSubscription === "none") return "None";
		return userSubscription.charAt(0).toUpperCase() + userSubscription.slice(1);
	}, [isLoggedIn, userSubscription]);

	// ── Fingerprint (anonymous identity for prompt tracking) ──────────────────
	// Stored in localStorage so it persists across sessions without login.
	function getOrCreateFingerprint(): string {
		if (typeof window === "undefined") return "";
		let fp = localStorage.getItem("kafelot_fp");
		if (!fp) {
			fp = crypto.randomUUID ? crypto.randomUUID() : `fp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			localStorage.setItem("kafelot_fp", fp);
		}
		return fp;
	}

	async function fetchPromptStatus(token?: string, scope: PromptScope = "general", updateDisplay = true) {
		try {
			const API_BASE = typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";
			const normalizedScope: PromptScope = scope === "molecule_helper" ? "molecule_helper" : "general";
			const fp = getOrCreateFingerprint();
			fingerprintRef.current = fp;
			const headers: Record<string, string> = {
				"x-kafelot-fingerprint": fp,
				"x-kafelot-scope": normalizedScope,
			};
			if (token) headers["authorization"] = `Bearer ${token}`;
			const res = await fetch(`${API_BASE}/api/kafelot/status?scope=${normalizedScope}`, { headers });
			if (token && res.status === 401) {
				setIsLoggedIn(false);
				setUserSubscription("none");
				clearAccountSession();
				return;
			}
			if (res.ok) {
				const data = (await res.json()) as {
					prompts_remaining: number;
					prompts_limit: number;
					reset_date?: string;
					tier?: string;
				};
				const backendTier = token ? normalizeUserSubscriptionTier(data.tier, userSubscription) : "free";
				const effectiveTier = backendTier === "none" ? (token ? userSubscription : "free") : backendTier;
				const normalizedCounters = normalizePromptCounters(
					data.prompts_remaining,
					data.prompts_limit,
					effectiveTier,
					!!token,
					normalizedScope,
				);

				updatePromptScopeState(normalizedScope, normalizedCounters, data.reset_date ?? null);
				if (updateDisplay && normalizedScope === activePromptScopeRef.current) {
					setPromptsRemaining(normalizedCounters.promptsRemaining);
					setPromptsLimit(normalizedCounters.promptsLimit);
					setPromptResetDate(data.reset_date ?? null);
					setLimitReached(normalizedCounters.promptsRemaining <= 0);
				}
				if (token && typeof data.tier === "string") {
					const backendTier = normalizeUserSubscriptionTier(data.tier, userSubscription);
					if (backendTier !== "none") {
						setUserSubscription(backendTier);
					}
				}
			}
		} catch {
			// Silently ignore – limits won't block usage on infra failure
		}
	}

	// Fix hydration: only render portal after mount
	useEffect(() => {
		setMounted(true);

		// Fetch stock data for coffee products
		const fetchStockData = async () => {
			try {
				const API_BASE = typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";
				const res = await fetch(`${API_BASE}/api/products/coffee`);
				if (res.ok) {
					const data = await res.json();
					const stockMap: StockData = {};
					data.products?.forEach(
						(p: {
							productId?: string;
							product_id?: string;
							productType?: string;
							price: number;
							stock: number;
							stockStatus?: string;
						}) => {
							const pid = p.productId || p.product_id;
							if (!pid) return;
							const entry = {
								price: p.price,
								stock: p.stock,
								stockStatus: p.stockStatus as StockData[string]["stockStatus"],
							};
							const variant: CapsuleVariant = p.productType === "vertuo" ? "vertuo" : "original";
							const base = pid.replace(/-(original|vertuo|vl)$/i, "");
							stockMap[buildVariantStockKey(pid, variant)] = entry;
							if (base !== pid) {
								stockMap[buildVariantStockKey(base, variant)] = entry;
							}
						},
					);
					setStockData(stockMap);
				}
			} catch {
				if (process.env.NODE_ENV !== "production") {
					console.warn("Coffee stock unavailable; recommender is using local product data.");
				}
			}
		};
		fetchStockData();

		// Load user session and subscription from sessionStorage
		if (typeof window !== "undefined") {
			try {
				const accountSession = readAccountSession();
				const storedIsLoggedIn = !!accountSession;
				setIsLoggedIn(storedIsLoggedIn);

				// Fetch subscription from DB via /api/subscriptions if logged in
				if (accountSession) {
					const token = accountSession.token;
					if (token) {
						const API_BASE =
							typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";
						const authHeaders = { Authorization: `Bearer ${token}` };
						const expireSession = () => {
							clearAccountSession();
							setIsLoggedIn(false);
							setUserSubscription("none");
							setSelectedModel("minilm_l6_v2_gguf");
							fetchPromptStatus(undefined, "general");
						};

						// Primary: Fetch subscription tier from subscriptions API (database)
						fetch(`${API_BASE}/api/subscriptions`, {
							headers: authHeaders,
						})
							.then(async (res) => {
								if (res.status === 401) {
									throw new Error("AUTH_EXPIRED");
								}
								if (!res.ok) {
									throw new Error(`SUBSCRIPTIONS_REQUEST_FAILED_${res.status}`);
								}
								return res.json();
							})
							.then((data) => {
								const tier = normalizeUserSubscriptionTier(data?.subscription?.tier, "none");
								if (tier === "none") {
									throw new Error("SUBSCRIPTIONS_TIER_MISSING");
								}
								setUserSubscription(tier);

								setSelectedModel("minilm_l6_v2_gguf");
							})
							.catch((subscriptionError) => {
								if ((subscriptionError as Error)?.message === "AUTH_EXPIRED") {
									expireSession();
									return;
								}

								// Fallback to /api/auth/me if subscriptions API fails
								fetch(`${API_BASE}/api/auth/me`, {
									headers: authHeaders,
								})
									.then(async (res) => {
										if (res.status === 401) {
											throw new Error("AUTH_EXPIRED");
										}
										if (!res.ok) {
											throw new Error(`AUTH_ME_REQUEST_FAILED_${res.status}`);
										}
										return res.json();
									})
									.then((data) => {
										const sub = normalizeUserSubscriptionTier(
											data?.user?.subscription ?? data?.user?.subscription_name,
											"none",
										);
										if (sub === "none") {
											throw new Error("AUTH_ME_SUBSCRIPTION_MISSING");
										}
										setUserSubscription(sub);
										setSelectedModel("minilm_l6_v2_gguf");
									})
									.catch((authError) => {
										if ((authError as Error)?.message === "AUTH_EXPIRED") {
											expireSession();
											return;
										}
										const sessionTier = normalizeUserSubscriptionTier(accountSession.subscription, "free");
										setUserSubscription(sessionTier);
										setSelectedModel("minilm_l6_v2_gguf");
									});
							});
					}
				}
			} catch {
				// ignore errors
			}
			// Load chat history only if logged in
			const accountSessionForHistory = readAccountSession();
			if (accountSessionForHistory) {
				// Load from server
				fetch("/api/chat/save", { cache: "no-store" })
					.then((res) => res.json())
					.then((data) => {
						if (data.history && Array.isArray(data.history)) {
							setChatHistory(data.history);
							lastSavedHistoryPayload = JSON.stringify({ history: data.history });
						}
					})
					.catch(() => {
						// ignore
					});
			}
		}
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const accountSession = readAccountSession();
		const token = accountSession?.token ?? undefined;
		const scope: PromptScope = chemistryMode ? "molecule_helper" : "general";
		fetchPromptStatus(token, scope, true);
		const hasMoleculeHelperAccess = (VISION_MODELS_BY_TIER[userSubscription] || []).length > 0;
		if (hasMoleculeHelperAccess) {
			const secondaryScope: PromptScope = scope === "general" ? "molecule_helper" : "general";
			fetchPromptStatus(token, secondaryScope, false);
		}
	}, [chemistryMode, isLoggedIn, userSubscription]);

	useEffect(() => {
		const activeHelper: HelperMode = chemistryMode ? "molecule_helper" : "coffee_helper";
		helperConversationsRef.current[activeHelper] = {
			chatId: currentChatId,
			messages: [...chatMessages],
		};
	}, [chatMessages, currentChatId, chemistryMode]);

	useEffect(() => {
		if (!allowedTextModels.includes(selectedModel)) {
			setSelectedModel(allowedTextModels[0]);
		}
	}, [allowedTextModels, selectedModel]);

	useEffect(() => {
		if (allowedVisionModels.length === 0) return;
		if (!allowedVisionModels.includes(selectedVisionModel)) {
			setSelectedVisionModel(allowedVisionModels[0]);
		}
	}, [allowedVisionModels, selectedVisionModel]);

	useEffect(() => {
		if (!hasQwenThinkingAccess) {
			setThinkingEnabledByHelper({ coffee_helper: false, molecule_helper: false });
		}
	}, [hasQwenThinkingAccess]);

	useEffect(() => {
		// close on Escape
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") {
				if (mediaLightbox) {
					setMediaLightbox(null);
					return;
				}
				setOpen(false);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [mediaLightbox]);

	// Check Python AI health up to three times per page load
	useEffect(() => {
		let cancelled = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		const checkHealth = async (): Promise<boolean> => {
			try {
				const res = await fetch("/api/python-health", { cache: "no-store" });
				if (!res.ok) {
					if (!cancelled) {
						setSmarterAIAvailable(false);
					}
					return false;
				}
				const data = (await res.json()) as {
					status?: string;
					smarterAI?: boolean;
					healthy?: boolean;
				};
				const isHealthy = data.status === "ok" || data.smarterAI === true || data.healthy === true;
				if (!cancelled) {
					setSmarterAIAvailable(isHealthy);
				}
				return isHealthy;
			} catch (error) {
				if (!cancelled) {
					setSmarterAIAvailable(false);
				}
				return false;
			}
		};

		const wait = (ms: number) =>
			new Promise<void>((resolve) => {
				timeoutId = setTimeout(() => {
					timeoutId = null;
					resolve();
				}, ms);
			});

		const runChecks = async () => {
			for (let attempt = 0; attempt < 2 && !cancelled; attempt += 1) {
				const healthy = await checkHealth();
				if (cancelled || healthy) {
					break;
				}
				if (attempt < 1) {
					await wait(6000);
				}
			}
		};

		void runChecks();

		return () => {
			cancelled = true;
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		};
	}, []);

	// when the recommender opens, disable page scroll by toggling a body class
	useEffect(() => {
		if (typeof document === "undefined") return;
		const cls = "recommender-open";
		if (open) {
			document.body.classList.add(cls);
		} else {
			document.body.classList.remove(cls);
		}
		return () => document.body.classList.remove(cls);
	}, [open]);

	// Isolate wheel/scroll events inside the recommender window — momentum-based smooth scrolling
	useEffect(() => {
		const el = recommenderRef.current;
		if (!el) return;
		let velocity = 0;
		let rafId: number | null = null;
		let scrollEl: HTMLElement | null = null;
		const tick = () => {
			if (!scrollEl || Math.abs(velocity) < 0.28) {
				velocity = 0;
				rafId = null;
				return;
			}
			scrollEl.scrollTop += velocity;
			velocity *= 0.82; // stronger friction for slower deceleration
			rafId = requestAnimationFrame(tick);
		};
		const handleWheel = (e: WheelEvent) => {
			e.preventDefault();
			let target = e.target as HTMLElement | null;
			let found: HTMLElement | null = null;
			while (target && target !== el) {
				const { overflowY } = window.getComputedStyle(target);
				if ((overflowY === "auto" || overflowY === "scroll") && target.scrollHeight > target.clientHeight) {
					found = target;
					break;
				}
				target = target.parentElement;
			}
			if (!found) found = el.querySelector(".recommender-body") as HTMLElement | null;
			if (!found) return;
			if (found !== scrollEl) {
				velocity = 0;
				scrollEl = found;
			}
			velocity += e.deltaY * 0.28;
			if (!rafId) rafId = requestAnimationFrame(tick);
		};
		el.addEventListener("wheel", handleWheel, { passive: false });
		return () => {
			el.removeEventListener("wheel", handleWheel);
			if (rafId) cancelAnimationFrame(rafId);
		};
	}, [open]);

	const toggleNote = useCallback((note: string) => {
		setSelected((s) => (s.includes(note) ? s.filter((x) => x !== note) : [...s, note]));
	}, []);

	const toggleThinkingForActiveHelper = useCallback(() => {
		if (!hasQwenThinkingAccess) return;
		setThinkingEnabledByHelper((prev) => ({
			...prev,
			[activeHelperMode]: !prev[activeHelperMode],
		}));
	}, [activeHelperMode, hasQwenThinkingAccess]);

	// Reset textarea height when input is cleared (after send)
	useEffect(() => {
		if (chatInput === "" && textareaRef.current) {
			textareaRef.current.style.height = "auto";
		}
	}, [chatInput]);

	const recommend = useCallback(() => {
		// Filter by collection first (Original vs Vertuo)
		let products = allProducts;
		if (collectionFilter !== "all") {
			const targetCollection = collectionFilter === "original" ? "Original" : "Vertuo";
			products = products.filter((p) => {
				// detect by image path containing Original or Vertuo
				return p.image.includes(`/Capsules/${targetCollection}/`);
			});
		}

		// Enhanced keyword extraction with stemming-like simplification
		const keywords = new Set<string>(selected.map((s) => s.toLowerCase()));

		// Extract from quick query
		if (query.trim()) {
			query
				.toLowerCase()
				.split(/[^a-zA-Z\u00C0-\u017F\d]+/)
				.filter((w) => w.length >= 3)
				.forEach((w) => keywords.add(w));
		}

		// Extract from smart text with better tokenization
		if (smartText.trim()) {
			smartText
				.toLowerCase()
				.split(/[^a-zA-Z\u00C0-\u017F\d]+/)
				.filter((w) => w.length >= 3)
				.forEach((w) => {
					keywords.add(w);
					// add partial stems for fuzzy matching (first 4 chars if longer)
					if (w.length > 5) keywords.add(w.slice(0, 5));
				});
		}
		flavorGroups.forEach((g) => keywords.add(g.toLowerCase()));

		// Enhanced scoring with multi-field weighted matching
		const scored = products
			.map((p) => {
				const notes = p.notes?.map((n) => n.toLowerCase()) ?? [];
				const nameL = p.name.toLowerCase();
				const descL = (p.description ?? "").toLowerCase();
				let score = 0;

				keywords.forEach((kw) => {
					// exact note match (highest weight)
					if (notes.some((n) => n === kw)) score += 5;
					// partial note match (substring)
					else if (notes.some((n) => n.includes(kw) || kw.includes(n))) score += 3;

					// name exact match
					if (nameL.includes(kw)) score += 4;

					// description match
					if (descL.includes(kw)) score += 2;
				});

				// intensity preference bump if enabled
				if (intensityEnabled && p.intensity) {
					const diff = Math.abs(p.intensity - intensity);
					score += Math.max(0, 4 - diff); // closer intensity gives boost
				}

				// boost limited editions slightly
				if (p.image.includes("Limited Edition")) score += 1;

				return { p, score };
			})
			.filter((s) => s.score > 0)
			.sort((a, b) => {
				// sort by score descending, then by intensity (if enabled), then by price
				if (b.score !== a.score) return b.score - a.score;
				if (intensityEnabled && a.p.intensity && b.p.intensity) {
					const aDiff = Math.abs(a.p.intensity - intensity);
					const bDiff = Math.abs(b.p.intensity - intensity);
					if (aDiff !== bDiff) return aDiff - bDiff;
				}
				return b.p.priceRon - a.p.priceRon;
			})
			.map((s) => s.p)
			.slice(0, 12);

		// fallback: if nothing matched and there's any text input, do broad substring search
		if (scored.length === 0 && (query.trim().length > 0 || smartText.trim().length > 0)) {
			const combined = (query + " " + smartText).toLowerCase();
			const alt = products
				.filter((p) => p.name.toLowerCase().includes(combined) || p.description?.toLowerCase().includes(combined))
				.slice(0, 8);
			setResults(alt);
			setStep("results");
			return;
		}

		setResults(scored);
		setStep("results");
	}, [selected, smartText, flavorGroups, query, intensity, intensityEnabled, collectionFilter]);

	const handleAdd = useCallback((p: CoffeeProduct) => {
		// Open the same AddCapsulesPopup as the main page
		setSelectedProduct(p);
		setPopupOpen(true);
	}, []);

	// Save current chat to history (only if logged in)
	const saveCurrentChat = useCallback(() => {
		if (!isLoggedIn || chatMessages.length === 0) return;
		const preview = chatMessages[0]?.content.slice(0, 50) || "New conversation";

		let category: "coffee" | "chemistry" | "general" = "general";
		if (chemistryMode) category = "chemistry";
		else if (chatMode === "coffee") category = "coffee";

		const chatId = currentChatId || `chat-${Date.now()}`;
		const conversationSignature = JSON.stringify({
			id: chatId,
			model: selectedModel,
			category,
			messages: chatMessages,
		});
		if (conversationSignature === lastSavedConversationSignatureRef.current) {
			return;
		}

		const chat: ChatHistory = {
			id: chatId,
			timestamp: Date.now(),
			messages: chatMessages,
			preview,
			model: selectedModel,
			category: category,
		};
		const updated = [chat, ...chatHistory.filter((c) => c.id !== chat.id)];
		lastSavedConversationSignatureRef.current = conversationSignature;
		setChatHistory(updated);
		saveChatHistory(updated);
		setCurrentChatId(chat.id);
	}, [isLoggedIn, chatMessages, currentChatId, chatHistory, selectedModel, chemistryMode, chatMode]);

	// Auto-save chat when messages change (debounced, only if logged in)
	useEffect(() => {
		if (!isLoggedIn || chatMessages.length === 0 || step !== "chat" || isTyping) return;
		const timer = setTimeout(() => {
			saveCurrentChat();
		}, 5000); // save after the conversation settles
		return () => clearTimeout(timer);
	}, [isLoggedIn, chatMessages, step, isTyping, saveCurrentChat]);

	const switchHelperMode = useCallback(
		(nextChemistryMode: boolean) => {
			if (nextChemistryMode === chemistryMode) return;

			saveCurrentChat();

			const currentHelper: HelperMode = chemistryMode ? "molecule_helper" : "coffee_helper";
			helperConversationsRef.current[currentHelper] = {
				chatId: currentChatId,
				messages: [...chatMessages],
			};

			const targetHelper: HelperMode = nextChemistryMode ? "molecule_helper" : "coffee_helper";
			const targetSnapshot = helperConversationsRef.current[targetHelper];

			setChemistryMode(nextChemistryMode);
			setChatMode(nextChemistryMode ? "general" : "coffee");
			setChatInput("");
			setChatImages([]);
			editingMessageIdxRef.current = null;
			setEditingMessageIdx(null);
			lastSavedConversationSignatureRef.current = "";

			if (targetSnapshot.messages.length > 0) {
				setChatMessages(targetSnapshot.messages);
				setCurrentChatId(targetSnapshot.chatId);
				return;
			}

			setChatMessages([]);
			setCurrentChatId(null);
		},
		[chemistryMode, currentChatId, chatMessages, saveCurrentChat],
	);

	// Start a new chat
	const startNewChat = useCallback(() => {
		saveCurrentChat();
		lastSavedConversationSignatureRef.current = "";
		setChatMessages([]);
		setCurrentChatId(null);
		setChatInput("");
		setChatImages([]);
		const activeHelper: HelperMode = chemistryMode ? "molecule_helper" : "coffee_helper";
		helperConversationsRef.current[activeHelper] = { chatId: null, messages: [] };
		setStep("chat");
	}, [saveCurrentChat, chemistryMode]);

	// Load a chat from history
	const loadChat = useCallback(
		(chatId: string) => {
			const chat = chatHistory.find((c) => c.id === chatId);
			if (!chat) return;

			const currentHelper: HelperMode = chemistryMode ? "molecule_helper" : "coffee_helper";
			helperConversationsRef.current[currentHelper] = {
				chatId: currentChatId,
				messages: [...chatMessages],
			};

			const nextChemistryMode = chat.category === "chemistry";
			const targetHelper: HelperMode = nextChemistryMode ? "molecule_helper" : "coffee_helper";
			helperConversationsRef.current[targetHelper] = {
				chatId: chat.id,
				messages: chat.messages,
			};

			lastSavedConversationSignatureRef.current = JSON.stringify({
				id: chat.id,
				model: chat.model,
				category: chat.category,
				messages: chat.messages,
			});
			setChemistryMode(nextChemistryMode);
			setChatMode(nextChemistryMode ? "general" : chat.category === "coffee" ? "coffee" : "general");
			setChatMessages(chat.messages);
			setCurrentChatId(chat.id);
			setChatInput("");
			setChatImages([]);
			setStep("chat");
		},
		[chatHistory, chemistryMode, currentChatId, chatMessages],
	);

	// Delete a chat from history
	const deleteChat = useCallback(
		(chatId: string) => {
			const updated = chatHistory.filter((c) => c.id !== chatId);
			setChatHistory(updated);
			saveChatHistory(updated);
		},
		[chatHistory],
	);

	const handleConfirmCapsules = useCallback(
		(capsules: number) => {
			if (!selectedProduct) return;
			if (capsules >= 10) {
				const sleeves = Math.floor(capsules / 10);
				const itemName = `${selectedProduct.name} - ${selectedProduct.priceRon.toFixed(2).replace(".", ",")} RON`;
				addItem({
					id: selectedProduct.id,
					name: itemName,
					price: selectedProduct.priceRon,
					qty: sleeves,
					image: selectedProduct.image,
				});
				notify(
					`Added ${sleeves} sleeve${sleeves > 1 ? "s" : ""} (${capsules} capsules) of ${selectedProduct.name} to bag!`,
					6000,
					"success",
					"coffee",
				);
			}
			setPopupOpen(false);
			setSelectedProduct(null);
		},
		[selectedProduct, addItem, notify],
	);

	// Fallback response generation for offline/error scenarios
	const generateFallbackResponse = useCallback((input: string, mode: string) => {
		let response = "";
		let recommendedProducts: CoffeeProduct[] = [];

		if (mode === "general") {
			if (input.includes("hello") || input.includes("hi")) {
				response = "Hello! I'm Kafelot, your AI assistant. How can I help you today?";
			} else if (input.includes("help")) {
				response =
					"I can assist with coffee recommendations, brewing methods, or general questions. What would you like to know?";
			} else {
				response =
					"That's interesting! I'm here to help with coffee expertise or general conversations. What would you like to discuss?";
			}
		} else {
			// Coffee mode fallback
			if (input.includes("strong") || input.includes("intense")) {
				const strong = allProducts.filter((p) => (p.intensity ?? 0) >= 10).slice(0, 4);
				response =
					"As Kafelot, your coffee pilot explorer, I recommend these high-intensity capsules for a strong coffee experience:";
				recommendedProducts = strong;
			} else if (input.includes("sweet") || input.includes("chocolate") || input.includes("caramel")) {
				const sweet = allProducts
					.filter((p) =>
						p.notes?.some((n) =>
							["chocolate", "caramel", "sweet", "honey"].some((kw) => n.toLowerCase().includes(kw)),
						),
					)
					.slice(0, 4);
				response = "For sweet, chocolatey flavors, Kafelot suggests these:";
				recommendedProducts = sweet;
			} else if (input.includes("fruity") || input.includes("citrus") || input.includes("floral")) {
				const fruity = allProducts
					.filter((p) =>
						p.notes?.some((n) => ["citrus", "floral", "fruity", "berry"].some((kw) => n.toLowerCase().includes(kw))),
					)
					.slice(0, 4);
				response = "For bright, fruity notes, Kafelot recommends these great choices:";
				recommendedProducts = fruity;
			} else {
				const tokens = input.split(/\s+/).filter((w) => w.length > 3);
				const matches = allProducts
					.filter((p) =>
						tokens.some((t) => p.name.toLowerCase().includes(t) || p.description?.toLowerCase().includes(t)),
					)
					.slice(0, 4);
				if (matches.length > 0) {
					response = "Based on your query, Kafelot has found these suggestions:";
					recommendedProducts = matches;
				} else {
					response =
						"I'm Kafelot, your coffee pilot explorer! Tell me about your preferences - intensity, flavors, or time of day - and I'll find the perfect capsule for you.";
				}
			}
		}

		return { response, products: recommendedProducts };
	}, []);

	// Fetch molecule data from backend
	const fetchMoleculeData = useCallback(
		async (moleculeIdentifier: string, fallbackMolecule?: Record<string, unknown>) => {
			try {
				const encodedIdentifier = encodeURIComponent(moleculeIdentifier);
				const smilesQuery =
					typeof fallbackMolecule?.smiles === "string" && fallbackMolecule.smiles.trim().length > 0
						? `?smiles=${encodeURIComponent(fallbackMolecule.smiles)}`
						: "";
				const svgQuery = smilesQuery ? `${smilesQuery}&width=500&height=360` : "?width=500&height=360";
				const sdfQuery = smilesQuery ? `${smilesQuery}&width=620&height=320` : "?width=620&height=320";
				const cacheKey = `${moleculeIdentifier}|${visualizationMode}|${fallbackMolecule?.smiles || ""}`;
				const cached = moleculeVizCacheRef.current[cacheKey];
				if (cached) {
					return {
						...cached.molecule,
						svg: cached.svg,
						sdf: cached.sdf,
					};
				}

				let molecule: Record<string, unknown> | null = fallbackMolecule ?? null;
				if (!molecule) {
					const detailsRes = await fetch(`/api/molecule/${encodedIdentifier}`);
					if (!detailsRes.ok) {
						throw new Error(`Failed to fetch molecule details: ${detailsRes.statusText}`);
					}
					const detailsData = (await detailsRes.json()) as { molecule?: Record<string, unknown> };
					molecule = detailsData.molecule ?? null;
				}

				if (!molecule) {
					throw new Error("Molecule payload missing");
				}

				// Fetch SVG if needed
				let svgData: string | undefined;
				if (visualizationMode === "2d" || visualizationMode === "both") {
					try {
						const svgRes = await fetch(`/api/molecule/svg/${encodedIdentifier}${svgQuery}`);
						if (svgRes.ok) {
							svgData = await svgRes.text();
						}
					} catch (error) {
						console.warn("Failed to fetch SVG:", error);
					}
				}

				// Fetch SDF if needed
				let sdfData: string | undefined;
				if (visualizationMode === "3d" || visualizationMode === "both") {
					try {
						const sdfRes = await fetch(`/api/molecule/sdf/${encodedIdentifier}${sdfQuery}`);
						if (sdfRes.ok) {
							sdfData = await sdfRes.text();
						}
					} catch (error) {
						console.warn("Failed to fetch SDF:", error);
					}
				}

				moleculeVizCacheRef.current[cacheKey] = {
					molecule,
					svg: svgData,
					sdf: sdfData,
				};

				return {
					...molecule,
					svg: svgData,
					sdf: sdfData,
				};
			} catch (error) {
				console.error("Error fetching molecule data:", error);
				notify("Failed to load molecule visualization", 3000, "error", "coffee");
				return null;
			}
		},
		[visualizationMode, notify],
	);

	// Smart AI-like chat handler
	const handleChatSubmit = useCallback(async () => {
		if (isTyping) return;
		const now = Date.now();
		if (now - submitCooldownRef.current < 900) return;
		submitCooldownRef.current = now;

		const prompt = chatInput.trim();
		if (!prompt && chatImages.length === 0) return;

		const imageDataUrls = await Promise.all(
			chatImages.map(
				(file) =>
					new Promise<string | null>((resolve) => {
						const reader = new FileReader();
						reader.onloadend = () => resolve(reader.result as string);
						reader.onerror = () => resolve(null);
						reader.readAsDataURL(file);
					}),
			),
		);
		const validImageDataUrls = imageDataUrls.filter((value): value is string => Boolean(value));
		const userMsg: Message = {
			role: "user",
			content: prompt || (validImageDataUrls.length > 0 ? "" : "[Image attached]"),
			...(validImageDataUrls.length > 0 ? { image: validImageDataUrls[0] } : {}),
			...(validImageDataUrls.length > 1 ? { images: validImageDataUrls } : {}),
		};
		const editIdx = editingMessageIdxRef.current;
		const messagesForApi = editIdx !== null ? chatMessages.slice(0, editIdx) : chatMessages;
		if (editIdx !== null) {
			setChatMessages((m) => [...m.slice(0, editIdx), userMsg]);
			editingMessageIdxRef.current = null;
			setEditingMessageIdx(null);
		} else {
			setChatMessages((m) => [...m, userMsg]);
		}
		setChatInput("");
		const imagesToSend = [...chatImages];
		setChatImages([]);

		let imageToSend: File | null = null;
		if (imagesToSend.length === 1) {
			imageToSend = imagesToSend[0];
		} else if (imagesToSend.length > 1) {
			try {
				imageToSend = await combinePromptImagesAsJpeg(imagesToSend);
				notify(`Combined ${imagesToSend.length} images into one Coffee Helper prompt image.`, 2800, "info", "coffee");
			} catch {
				imageToSend = imagesToSend[0];
				notify(
					"Could not combine all selected images. Sending only the first image for this prompt.",
					4200,
					"error",
					"coffee",
				);
			}
		}
		setIsTyping(true);

		const lowerPrompt = prompt.toLowerCase();
		const moleculeRequested =
			chemistryMode && (isMoleculeQuery(prompt) || /CHEMBL\d+/i.test(prompt) || !!extractMoleculeQuery(prompt));
		const helperModeForPrompt: HelperMode = chemistryMode ? "molecule_helper" : "coffee_helper";
		const thinkingToggleEnabled = thinkingEnabledByHelper[helperModeForPrompt];
		const thinkingEligibleModel = selectedModel === "qwen3_06b_q8_0_gguf" && hasQwenThinkingAccess;
		const enableThinking = shouldEnableThinkingForPrompt(prompt, thinkingEligibleModel, thinkingToggleEnabled);
		const selectedTextModelLabel = TEXT_MODEL_LABEL_BY_KEY[selectedModel];
		const selectedVisionModelLabel = VISION_MODEL_LABEL_BY_KEY[selectedVisionModel];

		if (imageToSend && !hasVisionAccess) {
			const lockedVisionMsg: Message = {
				role: "assistant",
				content: "Image analysis is available for BASIC, PLUS, PRO, MAX, and ULTIMATE subscriptions.",
				modelUsed: "qwen3-vl-2b-q4_0-gguf-locked-tier",
			};
			setChatMessages((m) => [...m, lockedVisionMsg]);
			setIsTyping(false);
			return;
		}

		try {
			// Create AbortController for this request
			abortControllerRef.current = new AbortController();

			// Generate unique request ID for server-side cancellation
			const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
			currentRequestIdRef.current = requestId;

			// Always use Python chat endpoint for normal app behavior.
			const shouldUsePython = true;
			const endpoint = shouldUsePython ? "/api/python-chat" : "/api/chat";
			const modelForRequest = chemistryMode ? "tanka_chemistry" : "tanka_semantic";
			const promptScope: PromptScope = chemistryMode ? "molecule_helper" : "general";

			let fetchBody: BodyInit;
			let fetchHeaders: Record<string, string> = {};

			// Always include fingerprint for prompt tracking
			const fp = fingerprintRef.current || getOrCreateFingerprint();
			fingerprintRef.current = fp;

			// Include auth token if logged in
			const sessionToken = readAccountSession()?.token ?? undefined;

			if (imageToSend && shouldUsePython) {
				const fd = new FormData();
				fd.append("messages", JSON.stringify([...messagesForApi, userMsg]));
				fd.append("mode", chatMode);
				fd.append("model", modelForRequest);
				fd.append("text_model", selectedModel);
				fd.append("vision_model", selectedVisionModel);
				fd.append("subscription", userSubscription || "");
				fd.append("enable_thinking", String(enableThinking));
				fd.append("chemistry_mode", String(chemistryMode));
				fd.append("request_id", requestId);
				fd.append("image", imageToSend);
				fetchBody = fd;
				if (fp) fetchHeaders["x-kafelot-fingerprint"] = fp;
				fetchHeaders["x-kafelot-scope"] = promptScope;
				if (sessionToken) fetchHeaders["authorization"] = `Bearer ${sessionToken}`;
			} else {
				fetchHeaders = { "Content-Type": "application/json" };
				if (fp) fetchHeaders["x-kafelot-fingerprint"] = fp;
				fetchHeaders["x-kafelot-scope"] = promptScope;
				if (sessionToken) fetchHeaders["authorization"] = `Bearer ${sessionToken}`;
				fetchBody = JSON.stringify({
					messages: [...messagesForApi, userMsg],
					mode: chatMode,
					model: modelForRequest,
					text_model: selectedModel,
					vision_model: selectedVisionModel,
					subscription: userSubscription,
					enable_thinking: enableThinking,
					chemistry_mode: chemistryMode,
					context: { products: allProducts },
					request_id: requestId,
				});
			}

			const response = await fetch(endpoint, {
				method: "POST",
				headers: fetchHeaders,
				body: fetchBody,
				signal: abortControllerRef.current.signal,
			});

			if (!response.ok) {
				const errorData = await response.json().catch(
					() =>
						({}) as {
							error?: string;
							message?: string;
							model_used?: string;
							reset_date?: string;
							prompts_limit?: number;
							prompts_remaining?: number;
							subscription_tier?: string;
							tier?: string;
						},
				);
				if (response.status === 401 || errorData.error === "AUTH_SESSION_INVALID") {
					clearAccountSession();
					setIsLoggedIn(false);
					setUserSubscription("none");
					fetchPromptStatus(undefined, chemistryMode ? "molecule_helper" : "general");
					const authMsg: Message = {
						role: "assistant",
						content: "Your session expired. Please log in again to continue with subscription access.",
					};
					setChatMessages((m) => [...m, authMsg]);
					return;
				}
				if (errorData.error === "PROMPT_LIMIT_REACHED") {
					const rawTier = errorData.subscription_tier || errorData.tier;
					const backendTier = normalizeUserSubscriptionTier(rawTier, userSubscription);
					const effectiveTier = backendTier === "none" ? userSubscription : backendTier;
					const normalizedCounters = normalizePromptCounters(
						errorData.prompts_remaining ?? 0,
						errorData.prompts_limit,
						effectiveTier,
						isLoggedIn,
						promptScope,
					);
					setPromptsRemaining(normalizedCounters.promptsRemaining);
					setPromptsLimit(normalizedCounters.promptsLimit);
					updatePromptScopeState(promptScope, normalizedCounters, errorData.reset_date ?? null);
					setLimitReached(normalizedCounters.promptsRemaining <= 0);
					const resetText = errorData.reset_date
						? ` Your limit resets on ${new Date(errorData.reset_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
						: " Your limit resets next month.";
					const limitMsg: Message = {
						role: "assistant",
						content: `⚠️ You have reached your prompt limit for this month.${resetText} Please upgrade your subscription or wait for the reset.`,
					};
					setChatMessages((m) => [...m, limitMsg]);
					return;
				}

				if (errorData.error === "VISION_MODEL_LOCKED") {
					const lockedMsg: Message = {
						role: "assistant",
						content:
							errorData.message ||
							"Image analysis is available for BASIC, PLUS, PRO, MAX, and ULTIMATE subscriptions.",
						modelUsed: errorData.model_used || "qwen3-vl-2b-q4_0-gguf-locked-tier",
					};
					setChatMessages((m) => [...m, lockedMsg]);
					return;
				}

				if (
					errorData.error === "QWEN_THINKING_UNAVAILABLE" ||
					isHighDemandUnavailableModel(errorData.model_used) ||
					String(errorData.message || "")
						.toLowerCase()
						.includes("high demand")
				) {
					const runtimeLabel = imageToSend ? selectedVisionModelLabel : selectedTextModelLabel;
					const unavailableMsg: Message = {
						role: "assistant",
						content:
							errorData.message ||
							`${runtimeLabel} runtime is in high demand right now, we're sorry for unavailability.`,
						modelUsed:
							errorData.model_used ||
							(imageToSend
								? "qwen3-vl-2b-q4_0.gguf-vision-unavailable-high-demand"
								: "minilm-l6-v2-gguf-unavailable-high-demand"),
					};
					setChatMessages((m) => [...m, unavailableMsg]);
					if (typeof errorData.prompts_remaining === "number" || typeof errorData.prompts_limit === "number") {
						const backendTier = normalizeUserSubscriptionTier(errorData.subscription_tier, userSubscription);
						const effectiveTier = backendTier === "none" ? userSubscription : backendTier;
						const normalizedCounters = normalizePromptCounters(
							errorData.prompts_remaining,
							errorData.prompts_limit,
							effectiveTier,
							isLoggedIn,
							promptScope,
						);
						setPromptsRemaining(normalizedCounters.promptsRemaining);
						setPromptsLimit(normalizedCounters.promptsLimit);
						updatePromptScopeState(promptScope, normalizedCounters);
						setLimitReached(normalizedCounters.promptsRemaining <= 0);
					}
					if (typeof errorData.subscription_tier === "string") {
						const backendTier = normalizeUserSubscriptionTier(errorData.subscription_tier, userSubscription);
						if (backendTier !== "none") {
							setUserSubscription(backendTier);
						}
					}
					return;
				}

				if (response.status === 429) {
					const burstMsg: Message = {
						role: "assistant",
						content: "⚠️ Too many requests in a very short time. Please wait a few seconds and try again.",
					};
					setChatMessages((m) => [...m, burstMsg]);
					return;
				}
				throw new Error(errorData.error || errorData.message || `Failed to get response (Status: ${response.status})`);
			}

			const data = await response.json();

			// Check if request was cancelled on the server
			if (data.cancelled) {
				return; // Silently exit, user cancelled
			}

			if (typeof data.subscription_tier === "string") {
				const backendTier = normalizeUserSubscriptionTier(data.subscription_tier, userSubscription);
				if (backendTier !== "none") {
					setUserSubscription(backendTier);
				}
			}

			// Decrement local prompt count after a successful AI response
			if (typeof data.prompts_remaining === "number") {
				const backendTier = normalizeUserSubscriptionTier(data.subscription_tier, userSubscription);
				const effectiveTier = backendTier === "none" ? userSubscription : backendTier;
				const normalizedCounters = normalizePromptCounters(
					data.prompts_remaining,
					data.prompts_limit,
					effectiveTier,
					isLoggedIn,
					promptScope,
				);
				setPromptsRemaining(normalizedCounters.promptsRemaining);
				setPromptsLimit(normalizedCounters.promptsLimit);
				updatePromptScopeState(promptScope, normalizedCounters);
				setLimitReached(normalizedCounters.promptsRemaining <= 0);
			} else {
				setPromptsRemaining((prev) => {
					if (prev === null) return prev;
					const next = Math.max(0, prev - 1);
					if (next <= 0) setLimitReached(true);
					return next;
				});
				setPromptUsageByScope((prev) => {
					const current = prev[promptScope];
					if (current.promptsRemaining === null) return prev;
					const next = Math.max(0, current.promptsRemaining - 1);
					return {
						...prev,
						[promptScope]: {
							...current,
							promptsRemaining: next,
						},
					};
				});
			}

			const modelUsedLabel =
				typeof data.model_used === "string" && data.model_used.trim().length > 0
					? data.model_used
					: typeof data.model === "string" && data.model.trim().length > 0
						? data.model
						: "Kafelot";
			const isUnavailableModel =
				isHighDemandUnavailableModel(modelUsedLabel) ||
				String(data.response || "")
					.toLowerCase()
					.includes("high demand right now");

			let assistantContent = data.response;
			let attachedMolecule: MoleculeMessageView | undefined;
			if (chemistryMode && !isUnavailableModel) {
				if (visualizationMode !== "text" && moleculeRequested) {
					const chemblIdMatch = prompt.match(/CHEMBL\d+/i);
					const moleculeQuery = chemblIdMatch?.[0].toUpperCase() || extractMoleculeQuery(prompt) || "";
					if (!moleculeQuery) {
						assistantContent += "\n\n⚠️ Please provide a molecule name or a ChEMBL ID.";
					} else {
						const fallbackMol = await smartSearchMolecule(moleculeQuery);
						const resolvedIdentifier =
							fallbackMol?.chembl_id ||
							fallbackMol?.name ||
							(typeof fallbackMol?.smiles === "string" ? "smiles" : null);
						if (resolvedIdentifier && fallbackMol) {
							const moleculeData = await fetchMoleculeData(resolvedIdentifier, fallbackMol);
							if (moleculeData) {
								attachedMolecule = moleculeData;
							} else {
								assistantContent +=
									"\n\n⚠️ Molecule details were matched, but the requested visualization could not be loaded.";
							}
						} else {
							assistantContent += `\n\n⚠️ I could not find a molecule match for \"${moleculeQuery}\".`;
						}
					}
				}
			}

			const assistantMsg: Message = {
				role: "assistant",
				content: assistantContent,
				modelUsed: modelUsedLabel,
				products: data.products || [],
				...(attachedMolecule ? { molecule: attachedMolecule } : {}),
			};

			setChatMessages((m) => [...m, assistantMsg]);
		} catch (error) {
			// Check if it was aborted by user
			if (error instanceof Error && error.name === "AbortError") {
				// User cancelled, don't show error
				return;
			}
			console.error("Chat error:", error);
			const errorText =
				error instanceof Error
					? `${error.name}: ${error.message}`
					: typeof error === "string"
						? error
						: JSON.stringify(error);
			const isTimeoutLikeError = /aborterror|timeout|timed out|headers?timeout/i.test(errorText);
			if (chemistryMode) {
				const runtimeLabel = imageToSend ? selectedVisionModelLabel : selectedTextModelLabel;
				const modelUsed = imageToSend
					? `${selectedVisionModelLabel}-vision-unavailable-high-demand`
					: `${selectedTextModelLabel}-unavailable-chemistry-high-demand`;
				const chemistryUnavailableMsg: Message = {
					role: "assistant",
					content: `${runtimeLabel} runtime is in high demand right now, we're sorry for unavailability.`,
					modelUsed,
				};
				setChatMessages((m) => [...m, chemistryUnavailableMsg]);
				return;
			}
			const fallbackResponse = generateFallbackResponse(lowerPrompt, chatMode);
			const assistantMsg: Message = {
				role: "assistant",
				content: isTimeoutLikeError
					? "The selected model is taking too long right now, so I switched to a fast MiniLM fallback response.\n\n" +
						fallbackResponse.response
					: fallbackResponse.response,
				modelUsed: isTimeoutLikeError ? "MiniLM (timeout fallback)" : "Local fallback response",
				products: fallbackResponse.products,
			};
			setChatMessages((m) => [...m, assistantMsg]);
		} finally {
			abortControllerRef.current = null;
			currentRequestIdRef.current = null;
			setIsTyping(false);
		}
	}, [
		chatInput,
		chatImages,
		chatMessages,
		chatMode,
		userSubscription,
		generateFallbackResponse,
		smarterAIAvailable,
		chemistryMode,
		hasQwenThinkingAccess,
		selectedModel,
		selectedVisionModel,
		hasVisionAccess,
		thinkingEnabledByHelper,
		visualizationMode,
		fetchMoleculeData,
		isTyping,
		notify,
	]);

	const handleVisionFileSelection = useCallback(
		async (files: File[] | null) => {
			if (!files || files.length === 0) return;

			const slotsAvailable = Math.max(0, maxImagesPerPrompt - chatImages.length);
			if (slotsAvailable <= 0) {
				notify(
					`You can attach up to ${maxImagesPerPrompt} image${maxImagesPerPrompt === 1 ? "" : "s"} per prompt in this mode.`,
					3600,
					"error",
					"coffee",
				);
				return;
			}

			const acceptedFiles: File[] = [];
			let previewConvertedCount = 0;
			let previewConversionFailedCount = 0;
			const candidateFiles = files.slice(0, slotsAvailable);

			for (const file of candidateFiles) {
				const validation = await validateVisionUploadCandidate(file, userSubscription);
				if (!validation.ok) {
					notify(validation.message, 4200, "error", "coffee");
					continue;
				}

				let previewFile = file;
				const mime = normalizeImageMime(file.type);
				const extension = extractFileExtension(file.name);
				const shouldPreviewAsJpeg = hasVisionAutoConvert && !isDirectPngOrJpegType(mime, extension);

				if (shouldPreviewAsJpeg) {
					try {
						previewFile = await convertVisionUploadToJpegPreview(file, MIN_VISION_IMAGE_DIMENSION_PX);
						previewConvertedCount += 1;
					} catch {
						previewConversionFailedCount += 1;
					}
				}

				acceptedFiles.push(previewFile);
			}

			if (acceptedFiles.length > 0) {
				setChatImages((prev) => [...prev, ...acceptedFiles].slice(0, maxImagesPerPrompt));
			}

			if (files.length > slotsAvailable) {
				notify(
					`Only ${maxImagesPerPrompt} image${maxImagesPerPrompt === 1 ? "" : "s"} can be attached per prompt in this mode.`,
					3200,
					"info",
					"coffee",
				);
			}

			if (hasVisionAutoConvert && acceptedFiles.length > 0) {
				if (previewConversionFailedCount > 0) {
					notify(
						`Could not create ${previewConversionFailedCount} JPG preview${previewConversionFailedCount === 1 ? "" : "s"} locally. The upload will be converted server-side for ${userSubscription.toUpperCase()}.`,
						3600,
						"info",
						"coffee",
					);
				} else if (previewConvertedCount > 0) {
					notify(
						`${previewConvertedCount} image${previewConvertedCount === 1 ? "" : "s"} converted to JPG preview. Auto-convert/upscale is enabled for ${userSubscription.toUpperCase()}.`,
						2800,
						"info",
						"coffee",
					);
				}
			}
		},
		[chatImages.length, hasVisionAutoConvert, maxImagesPerPrompt, notify, userSubscription],
	);

	// Stop generation handler
	const handleStopGeneration = useCallback(async () => {
		// Abort the frontend fetch
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}

		// Cancel on the server side
		if (currentRequestIdRef.current) {
			try {
				await fetch(`/api/python-chat?request_id=${currentRequestIdRef.current}`, {
					method: "DELETE",
				});
			} catch (e) {
				// Ignore cancellation errors
				console.warn("Failed to cancel server request:", e);
			}
			currentRequestIdRef.current = null;
		}

		setIsTyping(false);
		notify("Generation stopped", 2000, "info", "coffee");
	}, [notify]);

	const handleChatKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleChatSubmit();
			}
		},
		[handleChatSubmit],
	);

	const dock = (
		<div ref={recommenderRef} className={`recommender-window ${open ? "open" : "closed"}`} role="dialog" aria-hidden={!open}>
			<div className="recommender-header">
				<div className="recommender-header-meta">
					<strong>Kafelot</strong>
					<div
						className="smarter-ai-badge"
						data-status={smarterAIAvailable ? "online" : "offline"}
						title={`Smarter AI status: ${smarterAIAvailable ? "Online" : "Offline"}`}
						aria-live="polite"
					>
						<span className="badge-icon">
							<BrandAnthropicIcon size={14} />
						</span>
						<span className="badge-text">
							<span className="badge-status">{smarterAIAvailable ? "Online" : "Offline"}</span>
						</span>
					</div>
				</div>
				<div className="recommender-actions">
					<button
						className="recommender-close"
						aria-label="Close"
						onClick={() => setOpen(false)}
						style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
					>
						<XIcon size={24} />
					</button>
				</div>
			</div>
			<div className="recommender-body">
				{step === "greeting" && (
					<div className="recommender-greeting">
						<p className="recommender-greeting-intro">
							Hello! I&apos;m Kafelot, your coffee pilot explorer. I can recommend capsules based on your
							preferences, answer questions about coffee, and help you discover new flavors.
						</p>
						{!isLoggedIn && (
							<div className="login-notice">
								<div
									style={{
										fontSize: "0.9rem",
										color: "rgba(250, 204, 144, 0.7)",
										margin: "0.5rem 0",
										display: "flex",
										alignItems: "center",
										gap: "0.5rem",
									}}
								>
									<BulbSvg className="recommender-inline-icon" />{" "}
									<div>
										<strong>Tip:</strong> Log in to unlock chat history and subscription-based Qwen 3 for
										Molecule Helper text chemistry.
									</div>
								</div>
							</div>
						)}
						<div className="recommender-cta recommender-tabs">
							<button onClick={() => setStep("chat")}>
								<MessageCircleIcon className="recommender-inline-icon" />
								<span className="recommender-tab-content">
									<span className="recommender-tab-title">Chat with me</span>
									<span className="recommender-tab-subtitle">Coffee help and molecule guidance</span>
								</span>
							</button>
							<button onClick={() => setStep("prefs")}>
								<MagnifierIcon className="recommender-inline-icon" />
								<span className="recommender-tab-content">
									<span className="recommender-tab-title">Advanced search</span>
									<span className="recommender-tab-subtitle">Filter by notes, intensity, and collection</span>
								</span>
							</button>
							<button
								onClick={async () => {
									setStep("results");
									const cachedPopular = readSnapshot<Array<{ product_id: string }>>(
										POPULAR_PRODUCTS_CACHE_KEY,
										POPULAR_PRODUCTS_CACHE_TTL_MS,
									);
									if (cachedPopular?.length) {
										const popular = cachedPopular
											.map((p) => allProductsById.get(p.product_id))
											.filter(Boolean) as CoffeeProduct[];
										if (popular.length > 0) {
											setResults(popular);
											return;
										}
									}

									// Try to fetch popular from API first
									try {
										const API_BASE =
											typeof window === "undefined"
												? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"
												: "";
										const res = await fetch(`${API_BASE}/api/orders/popular?limit=5`);
										if (res.ok) {
											const data = await res.json();
											if (data.products && data.products.length > 0) {
												// Map API products to CoffeeProduct objects
												const popular = data.products
													.map((p: { product_id: string }) => allProductsById.get(p.product_id))
													.filter(Boolean) as CoffeeProduct[];
												if (popular.length > 0) {
													setResults(popular);
													return;
												}
											}
										}
									} catch {
										// Fall back to static data
									}
									// Fallback: show first 5 products
									setResults(allProducts.slice(0, 5));
								}}
							>
								<RocketIcon className="recommender-inline-icon" />
								<span className="recommender-tab-content">
									<span className="recommender-tab-title">Show popular</span>
									<span className="recommender-tab-subtitle">Top capsules chosen by shoppers</span>
								</span>
							</button>
							{isLoggedIn && chatHistory.length > 0 && (
								<button onClick={() => setStep("history")}>
									<HistoryCircleIcon className="recommender-inline-icon" />
									<span className="recommender-tab-content">
										<span className="recommender-tab-title">Chat history</span>
										<span className="recommender-tab-subtitle">Resume saved conversations</span>
									</span>
								</button>
							)}
							{isLoggedIn && (
								<button onClick={() => setStep("stats")}>
									<ChartBarIcon className="recommender-inline-icon" /> Stats
								</button>
							)}
						</div>
					</div>
				)}

				{step === "prefs" && (
					<div className="recommender-prefs">
						<label className="label-small">Coffee type</label>
						<div className="prefs-list">
							{["all", "original", "vertuo"].map((type) => (
								<button
									key={type}
									type="button"
									className={`prefs-chip ${collectionFilter === type ? "active" : ""}`}
									onClick={() => setCollectionFilter(type as typeof collectionFilter)}
								>
									{type.charAt(0).toUpperCase() + type.slice(1)}
								</button>
							))}
						</div>

						<label className="label-small">Quick search</label>
						<input
							placeholder="Type flavors you like (e.g. chocolate, floral)"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>

						<label className="label-small">Smart mode — describe what you want</label>
						<textarea
							placeholder="I love rich chocolate with a touch of caramel and citrus notes..."
							value={smartText}
							onChange={(e) => setSmartText(e.target.value)}
							rows={4}
						/>

						<div className="prefs-row">
							<div className="prefs-col">
								<label className="label-small">Select flavor notes</label>
								<div className="prefs-list">
									{allNotes.slice(0, 24).map((note) => (
										<button
											key={note}
											type="button"
											className={`prefs-chip ${selected.includes(note) ? "active" : ""}`}
											onClick={() => toggleNote(note)}
										>
											{note}
										</button>
									))}
								</div>
							</div>
							<div className="prefs-col prefs-col-narrow">
								<div className="intensity-filter-wrapper">
									<label className="intensity-filter-label">
										<input
											type="checkbox"
											checked={intensityEnabled}
											onChange={(e) => setIntensityEnabled(e.target.checked)}
										/>
										Filter by intensity
									</label>
									<div className="intensity-slider-group">
										<input
											type="range"
											min={1}
											max={13}
											value={intensity}
											onChange={(e) => {
												const newIntensity = Number(e.target.value);
												setIntensity(newIntensity);
												// Update CSS variable for gradient fill
												const percentage = ((newIntensity - 1) / (13 - 1)) * 100;
												(e.target as HTMLInputElement).style.setProperty("--value", `${percentage}%`);
											}}
											onInput={(e) => {
												// Update gradient on input event too for smooth feedback
												const newIntensity = Number(e.currentTarget.value);
												const percentage = ((newIntensity - 1) / (13 - 1)) * 100;
												(e.currentTarget as HTMLInputElement).style.setProperty(
													"--value",
													`${percentage}%`,
												);
											}}
											disabled={!intensityEnabled}
										/>
										<span className="intensity-value">{intensity}</span>
									</div>
								</div>

								<label className="label-small" style={{ marginTop: "12px" }}>
									Flavor groups
								</label>
								<div className="prefs-list">
									{["chocolate", "citrus", "floral", "nutty", "caramel", "spicy"].map((g) => (
										<button
											key={g}
											type="button"
											className={`prefs-chip ${flavorGroups.includes(g) ? "active" : ""}`}
											onClick={() =>
												setFlavorGroups((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))
											}
										>
											{g}
										</button>
									))}
								</div>
							</div>
						</div>

						<div className="recommender-cta">
							<button onClick={() => recommend()}>Find Capsules</button>
							<button onClick={() => setStep("greeting")}>Back</button>
						</div>
					</div>
				)}

				{step === "results" && (
					<div className="recommender-results">
						{results.length === 0 ? (
							<p>No matches found — try different notes or a simpler query.</p>
						) : (
							<div className="results-list">
								{results.map((r) => {
									const forcedVariant =
										collectionFilter === "all" ? undefined : (collectionFilter as CapsuleVariant);
									const productStock = getVariantStock(stockData, r.id, r.image, forcedVariant);
									const stock = productStock?.stock ?? 100; // fallback avoids false out-of-stock when API is unavailable
									const isOutOfStock = productStock?.stockStatus === "out_of_stock" || stock <= 0;
									const isLowStock = productStock?.stockStatus === "low_stock" || (stock > 0 && stock < 40);

									return (
										<div
											key={r.id}
											className={`result-item ${isOutOfStock ? "out-of-stock" : ""}`}
											style={isOutOfStock ? { opacity: 0.5, filter: "grayscale(50%)" } : undefined}
										>
											<Image src={r.image} alt={r.name} width={70} height={48} unoptimized={true} />
											<div className="result-meta">
												<div className="result-name">{r.name}</div>
												<div className="result-desc">{r.description}</div>
												<div className="result-notes">
													{(r.notes ?? []).slice(0, 3).map((n) => (
														<span key={n} className="note-pill small">
															{n}
														</span>
													))}
												</div>
												{/* Stock status badge */}
												<div
													className={`stock-badge ${
														isOutOfStock ? "out-of-stock" : isLowStock ? "low-stock" : "in-stock"
													}`}
													style={{
														fontSize: "0.75rem",
														padding: "2px 8px",
														borderRadius: "4px",
														marginBottom: "4px",
														display: "inline-block",
														backgroundColor: isOutOfStock
															? "rgba(231, 76, 60, 0.2)"
															: isLowStock
																? "rgba(243, 156, 18, 0.2)"
																: "rgba(46, 204, 113, 0.2)",
														color: isOutOfStock ? "#e74c3c" : isLowStock ? "#f39c12" : "#2ecc71",
													}}
												>
													{isOutOfStock
														? "Out of stock"
														: isLowStock
															? `${stock} sleeves left`
															: "In Stock"}
												</div>
												<div className="result-actions">
													<button
														className="btn-ghost"
														onClick={() => handleAdd(r)}
														disabled={isOutOfStock}
														style={isOutOfStock ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
													>
														{isOutOfStock ? "Out of stock" : "Add to bag"}
													</button>
													<button
														className="btn-link"
														onClick={() => {
															setQuery(r.name);
															setStep("prefs");
														}}
													>
														More like this
													</button>
												</div>
											</div>
										</div>
									);
								})}
							</div>
						)}
						<div className="recommender-cta results-cta">
							<button
								onClick={() => {
									setStep("prefs");
									setResults([]);
								}}
							>
								Refine
							</button>
							<button
								onClick={() => {
									setStep("greeting");
									setResults([]);
								}}
							>
								← Back
							</button>
						</div>
					</div>
				)}

				{step === "chat" && (
					<div className="recommender-chat">
						<div className="chat-mode-toggle">
							<button
								className={chatMode === "coffee" ? "active" : ""}
								onClick={() => {
									switchHelperMode(false);
								}}
								title="Coffee Helper Mode - Focused on Nespresso recommendations"
							>
								<CoffeeIcon size={16} /> Coffee Helper
							</button>

							<button
								className={chemistryMode ? "active chemistry-mode" : "chemistry-mode"}
								onClick={() => {
									switchHelperMode(true);
								}}
								title={
									hasVisionAccess
										? "Molecule Helper - text chemistry plus Qwen 3 VL vision analysis."
										: "Molecule Helper - text chemistry mode only. Vision upload requires BASIC or higher."
								}
							>
								<BrandGrokIcon size={16} /> Molecule Helper
							</button>
						</div>

						{
							<>
								<div className="subscription-info-box">
									<div className="subscription-status">
										<div
											style={{
												margin: 0,
												fontSize: "0.95rem",
												color: "rgba(250, 204, 144, 0.8)",
												display: "flex",
												alignItems: "center",
												gap: "0.5rem",
											}}
										>
											<ShoppingCartIcon size={16} />
											<span>
												<strong>Subscription:</strong> {subscriptionTierLabel}
											</span>
										</div>
										<div className="model-access-list">
											{allowedTextModels.map((modelKey) => (
												<span
													key={modelKey}
													className={`model-access-chip ${modelKey === "minilm_l6_v2_gguf" ? "minilm" : "qwen"}`}
												>
													{modelKey === "minilm_l6_v2_gguf" ? (
														<BrandGeminiIcon size={13} />
													) : modelKey === "gemma3_1b_it_q4_0_gguf" ? (
														<BrandAnthropicIcon size={13} />
													) : (
														<BrandQwenIcon size={13} />
													)}
													{TEXT_MODEL_LABEL_BY_KEY[modelKey]}
												</span>
											))}
											{hasVisionAccess ? (
												allowedVisionModels.map((visionKey) => (
													<span key={visionKey} className="model-access-chip clip">
														<CameraIcon size={13} /> {VISION_MODEL_LABEL_BY_KEY[visionKey]}
													</span>
												))
											) : (
												<span className="model-access-chip qwen">
													<LockIcon size={12} /> Vision locked on Free tier
												</span>
											)}
										</div>
										<p
											style={{
												margin: "0.35rem 0 0 0",
												fontSize: "0.82rem",
												color: "rgba(250, 204, 144, 0.65)",
											}}
										>
											{chemistryMode
												? hasVisionAccess
													? "Molecule Helper supports text chemistry plus Qwen 3 VL vision analysis."
													: "Molecule Helper text chemistry is available. Vision uploads require BASIC or higher."
												: hasGemmaAccess
													? "ULTIMATE can choose MiniLM V2, Qwen 3, or Gemma 3."
													: hasQwenThinkingAccess
														? "MAX can choose MiniLM V2 or Qwen 3, and can enable Qwen 3 Thinking mode."
														: hasQwenAccess
															? "BASIC, PLUS, and PRO can choose MiniLM V2 or Qwen 3."
															: "FREE uses MiniLM-L6-v2.gguf."}
										</p>
										{!isLoggedIn && (
											<p
												style={{
													margin: "0.25rem 0 0 0",
													fontSize: "0.78rem",
													color: "rgba(250, 204, 144, 0.56)",
												}}
											>
												Log in to unlock subscription-based model selection and higher prompt limits.
											</p>
										)}
									</div>
								</div>

								<div className="model-selector">
									<label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
										<BrandGeminiIcon size={16} /> Text Model
									</label>
									<select
										value={selectedModel}
										onChange={(e) => setSelectedModel(e.target.value as TextModelKey)}
										style={{
											width: "100%",
											background: "rgba(18, 18, 18, 0.95)",
											color: "rgba(250, 204, 144, 0.95)",
											border: "1px solid rgba(250, 204, 144, 0.3)",
											borderRadius: "8px",
											padding: "0.55rem 0.65rem",
										}}
									>
										{allowedTextModels.map((modelKey) => (
											<option key={modelKey} value={modelKey}>
												{TEXT_MODEL_LABEL_BY_KEY[modelKey]}
											</option>
										))}
									</select>
								</div>

								<div className="model-selector">
									<label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
										<CameraIcon size={16} /> Vision Model
									</label>
									<select
										value={selectedVisionModel}
										onChange={(e) => setSelectedVisionModel(e.target.value as VisionModelKey)}
										disabled={!hasVisionAccess}
										style={{
											width: "100%",
											background: "rgba(18, 18, 18, 0.95)",
											color: "rgba(250, 204, 144, 0.95)",
											border: "1px solid rgba(250, 204, 144, 0.3)",
											borderRadius: "8px",
											padding: "0.55rem 0.65rem",
											opacity: hasVisionAccess ? 1 : 0.6,
										}}
									>
										{(hasVisionAccess ? allowedVisionModels : ["qwen3_vl_2b_q4_0_gguf"]).map((visionKey) => (
											<option key={visionKey} value={visionKey}>
												{VISION_MODEL_LABEL_BY_KEY[visionKey as VisionModelKey]}
											</option>
										))}
									</select>
								</div>

								<div className="model-selector">
									<label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
										<BrandQwenIcon size={16} /> Thinking (
										{chemistryMode ? "Molecule Helper" : "Coffee Helper"})
									</label>
									<button
										className={thinkingEnabledForActiveHelper ? "active" : ""}
										onClick={toggleThinkingForActiveHelper}
										disabled={!hasQwenThinkingAccess || selectedModel !== "qwen3_06b_q8_0_gguf"}
										title={
											hasQwenThinkingAccess
												? selectedModel === "qwen3_06b_q8_0_gguf"
													? "Enable or disable Qwen 3 Thinking for this helper."
													: "Select Qwen 3 to enable this toggle."
												: "Thinking mode requires MAX or ULTIMATE subscription."
										}
									>
										<span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
											<BrandQwenIcon size={16} />
										</span>
										{thinkingEnabledForActiveHelper ? "Thinking ON" : "Thinking OFF"}
									</button>
								</div>
								<p
									style={{
										margin: "-6px 0 0 0",
										fontSize: "0.78rem",
										color: "rgba(250, 204, 144, 0.62)",
									}}
								>
									{hasQwenThinkingAccess
										? selectedModel === "qwen3_06b_q8_0_gguf"
											? "Thinking is saved separately for Coffee Helper and Molecule Helper. You can still use /think or /no_think per message."
											: "Thinking toggle activates only when Qwen 3 is selected."
										: "Thinking mode requires MAX or ULTIMATE subscription."}
								</p>

								{chemistryMode && (
									<div className="visualization-mode-selector" style={{ marginTop: "1rem" }}>
										<label
											style={{
												display: "flex",
												alignItems: "center",
												gap: "0.5rem",
												marginBottom: "0.5rem",
											}}
										>
											<MagnifierIcon size={16} /> Molecule Display:
										</label>
										<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
											<button
												className={visualizationMode === "text" ? "active" : ""}
												onClick={() => setVisualizationMode("text")}
												title="Text only - Show molecular properties without visualization"
											>
												<FileDescriptionIcon size={14} /> Text Only
											</button>
											<button
												className={visualizationMode === "2d" ? "active" : ""}
												onClick={() => setVisualizationMode("2d")}
												title="2D Structure - SVG molecular diagram"
											>
												2D Structure
											</button>
											<button
												className={visualizationMode === "3d" ? "active" : ""}
												onClick={() => setVisualizationMode("3d")}
												title="3D Model - SDF format for PyMOL"
											>
												3D Model
											</button>
											<button
												className={visualizationMode === "both" ? "active" : ""}
												onClick={() => setVisualizationMode("both")}
												title="Both 2D & 3D - Show all visualizations"
											>
												<RefreshIcon size={14} /> Both
											</button>
										</div>
										<div className="visualization-mode-hint">
											Chemistry replies always use the model. This selector decides whether to show text
											only, 2D, 3D, or both molecule views when a molecule is detected.
										</div>
									</div>
								)}

								{/* Model descriptions below buttons */}
								<div className="model-description">
									<div className="description-content">
										<div
											style={{
												fontWeight: 700,
												display: "flex",
												alignItems: "center",
												gap: "0.5rem",
												marginBottom: "0.25rem",
											}}
										>
											<SparklesIcon size={16} /> Kafelot
										</div>
										<p>
											Text model: {TEXT_MODEL_LABEL_BY_KEY[selectedModel]}. Vision model:{" "}
											{hasVisionAccess
												? VISION_MODEL_LABEL_BY_KEY[selectedVisionModel]
												: "Locked on Free tier"}
											.
										</p>
									</div>
								</div>
							</>
						}

						<div className="chat-messages">
							{chatMessages.length === 0 && (
								<div className={`chat-welcome ${chemistryMode ? "molecule-helper-welcome" : ""}`}>
									{chatMode === "coffee" ? (
										<>
											<div style={{ fontWeight: 600 }}>
												<CoffeeIcon size={16} className="inline mr-1" />{" "}
												<strong>Coffee Helper Mode</strong>
											</div>
											<p>Ask me anything about Nespresso capsules! For example:</p>
											<ul>
												<li>&quot;I want something strong for the morning&quot;</li>
												<li>&quot;What pairs well with dessert?&quot;</li>
												<li>&quot;I like sweet, chocolatey flavors&quot;</li>
												<li>&quot;Show me fruity options&quot;</li>
												<li>&quot;What&apos;s the difference between Original and Vertuo?&quot;</li>
											</ul>
										</>
									) : chemistryMode ? (
										<>
											<div style={{ fontWeight: 600 }}>
												<BrandGrokIcon size={16} className="inline mr-1" />{" "}
												<strong>Molecule Helper</strong>{" "}
												<span style={{ color: "rgba(250, 204, 144, 0.6)" }}>(Qwen 3 VL Vision)</span>
											</div>
											<p>Explore molecular structures with 2D/3D visualizations! Try asking:</p>
											<ul>
												<li>&quot;Show me caffeine molecule&quot;</li>
												<li>&quot;What is the structure of aspirin?&quot;</li>
												<li>&quot;Display glucose in 3D&quot;</li>
												<li>&quot;Find chlorogenic acid&quot;</li>
												<li>&quot;Show me CHEMBL25&quot;</li>
											</ul>
										</>
									) : (
										<>
											<div style={{ fontWeight: 600 }}>
												<CoffeeIcon size={16} className="inline mr-1" />{" "}
												<strong>Coffee Helper Mode</strong>
											</div>
											<p>Ask me anything about coffee topics, brewing techniques, and more. Try asking:</p>
											<ul>
												<li>&quot;How do different brewing methods affect flavor?&quot;</li>
												<li>&quot;Tell me about single-origin vs blends&quot;</li>
												<li>&quot;What are the health benefits of coffee?&quot;</li>
												<li>&quot;Explain coffee roasting levels&quot;</li>
												<li>&quot;What&apos;s the best way to store coffee?&quot;</li>
											</ul>
										</>
									)}
								</div>
							)}
							{chatMessages.map((msg, idx) => {
								const molecule = msg.molecule;
								const stylizedModel = msg.role === "assistant" ? getStylizedModelInfo(msg.modelUsed) : null;
								const has2d = Boolean(molecule?.svg);
								const has3d = Boolean(molecule?.sdf);
								const showMolecule = msg.role === "assistant" && (has2d || has3d);
								const moleculeTitle = molecule?.name || molecule?.chembl_id || "Molecule";
								const svgDataUrl =
									has2d && molecule?.svg
										? molecule.svg.startsWith("data:")
											? molecule.svg
											: `data:image/svg+xml;utf8,${encodeURIComponent(molecule.svg)}`
										: "";
								const interactive3d =
									has3d && Boolean(molecule?.sdf?.includes("<script") || molecule?.sdf?.includes("<!DOCTYPE"));
								const messageImages =
									msg.role === "user"
										? Array.isArray(msg.images) && msg.images.length > 0
											? msg.images
											: msg.image
												? [msg.image]
												: []
										: [];

								return (
									<div key={idx} className={`chat-message ${msg.role}`}>
										{msg.role === "assistant" && (
											<div className="chat-avatar">
												<GithubCopilotIcon size={20} />
											</div>
										)}
										{msg.role === "user" && messageImages.length > 0 && (
											<div
												className="chat-bubble-image"
												style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
											>
												{messageImages.map((imageSrc, imageIdx) => (
													<img
														key={`${idx}-img-${imageIdx}`}
														src={imageSrc}
														alt={`Attached image ${imageIdx + 1}`}
														className="chat-clickable-image"
														onClick={() =>
															setMediaLightbox({
																type: "image",
																src: imageSrc,
																title: `Attached image ${imageIdx + 1}`,
															})
														}
													/>
												))}
											</div>
										)}
										{msg.content && (
											<>
												<div className="chat-bubble-row">
													{msg.role === "user" &&
														(userSubscription === "max" || userSubscription === "ultimate") && (
															<button
																className="chat-msg-edit-btn"
																onClick={() => {
																	setEditingMessageIdx(idx);
																	editingMessageIdxRef.current = idx;
																	setChatInput(msg.content);
																}}
																title="Edit message"
															>
																<PenIcon size={15} />
															</button>
														)}
													<div className="chat-bubble">
														{msg.content.split("\n").map((line, i) => (
															<React.Fragment key={i}>
																{formatMarkdown(line)}
																{i < msg.content.split("\n").length - 1 && <br />}
															</React.Fragment>
														))}
													</div>
												</div>
												{msg.role === "assistant" && msg.modelUsed && stylizedModel && (
													<div className={`chat-model-used model-${stylizedModel.accent}`}>
														<span className="chat-model-icon">
															{stylizedModel.accent === "qwen" ? (
																<BrandQwenIcon size={12} />
															) : stylizedModel.accent === "minilm" ? (
																<BrandGeminiIcon size={12} />
															) : stylizedModel.accent === "clip" ? (
																<CameraIcon size={12} />
															) : (
																<BrandAnthropicIcon size={12} />
															)}
														</span>
														<span className="chat-model-text">{stylizedModel.label}</span>
													</div>
												)}
											</>
										)}

										{showMolecule && molecule && (
											<div className="chat-molecule-card">
												<div className="chat-molecule-head">
													<div className="chat-molecule-title">
														<SparklesIcon size={16} />
														<strong>{moleculeTitle}</strong>
													</div>
													{molecule.chembl_id && (
														<span className="chat-molecule-id">{molecule.chembl_id}</span>
													)}
												</div>
												<div className={`chat-molecule-visual-grid ${has2d && has3d ? "split" : ""}`}>
													{has2d && (
														<div className="chat-molecule-panel">
															<div className="chat-molecule-panel-title">2D Structure</div>
															<button
																type="button"
																className="chat-molecule-preview-button"
																onClick={() =>
																	setMediaLightbox({
																		type: "image",
																		src: svgDataUrl,
																		title: `${moleculeTitle} · 2D`,
																	})
																}
															>
																{molecule.svg?.startsWith("data:") ? (
																	<img
																		src={molecule.svg}
																		alt={`${moleculeTitle} 2D`}
																		className="chat-molecule-image"
																	/>
																) : (
																	<div
																		className="svg-container"
																		dangerouslySetInnerHTML={{ __html: molecule.svg || "" }}
																	/>
																)}
															</button>
														</div>
													)}

													{has3d && (
														<div className="chat-molecule-panel">
															<div className="chat-molecule-panel-title-row">
																<span className="chat-molecule-panel-title">3D View</span>
																{interactive3d && (
																	<button
																		type="button"
																		className="chat-molecule-expand-btn"
																		onClick={() =>
																			setMediaLightbox({
																				type: "html",
																				src: molecule.sdf || "",
																				title: `${moleculeTitle} · 3D`,
																			})
																		}
																	>
																		Expand
																	</button>
																)}
															</div>
															{interactive3d ? (
																<iframe
																	srcDoc={molecule.sdf}
																	className="chat-molecule-iframe"
																	title={`${moleculeTitle} 3D preview`}
																	sandbox="allow-scripts"
																	loading="lazy"
																/>
															) : (
																<div className="sdf-info">
																	<button
																		onClick={() => {
																			const blob = new Blob([molecule.sdf || ""], {
																				type: "chemical/x-mdl-sdfile",
																			});
																			const url = URL.createObjectURL(blob);
																			const a = document.createElement("a");
																			a.href = url;
																			a.download = `${molecule.chembl_id || moleculeTitle}.sdf`;
																			a.click();
																			URL.revokeObjectURL(url);
																		}}
																		className="download-sdf-btn"
																	>
																		<ArrowNarrowDownIcon size={14} /> Download SDF
																	</button>
																	<pre className="sdf-preview">
																		{molecule.sdf?.substring(0, 420)}...
																	</pre>
																</div>
															)}
														</div>
													)}
												</div>
											</div>
										)}

										{msg.products && msg.products.length > 0 && (
											<div className="chat-products">
												{msg.products.map((p) => {
													if (!p || !p.id) return null;
													const productStock = getVariantStock(stockData, p.id, p.image);
													const stock = productStock?.stock ?? 100;
													const isOutOfStock = stock === 0;

													return (
														<div
															key={p.id}
															className="chat-product-card"
															style={
																isOutOfStock
																	? { opacity: 0.5, filter: "grayscale(50%)" }
																	: undefined
															}
														>
															{p.image && (
																<Image
																	src={p.image}
																	alt={p.name}
																	width={50}
																	height={35}
																	unoptimized={true}
																/>
															)}
															<div className="chat-product-info">
																<strong>{p.name}</strong>
																<span className="chat-product-intensity">
																	Intensity: {p.intensity ?? "N/A"}
																</span>
																{isOutOfStock && (
																	<span style={{ fontSize: "0.7rem", color: "#e74c3c" }}>
																		Out of stock
																	</span>
																)}
															</div>
															<button
																className="chat-add-btn"
																onClick={() => handleAdd(p)}
																disabled={isOutOfStock}
																style={{
																	...(isOutOfStock
																		? { opacity: 0.5, cursor: "not-allowed" }
																		: {}),
																	display: "flex",
																	alignItems: "center",
																	justifyContent: "center",
																}}
															>
																{isOutOfStock ? <XIcon size={14} /> : "+"}
															</button>
														</div>
													);
												})}
											</div>
										)}
									</div>
								);
							})}
							{isTyping && (
								<div className="chat-message assistant">
									<div className="chat-bubble typing">
										<span></span>
										<span></span>
										<span></span>
									</div>
								</div>
							)}
						</div>
						<div className="chat-input-area">
							{chatImages.length > 0 && (
								<div className="chat-image-preview" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
									{chatImages.map((imageFile, imageIdx) => (
										<div key={`${imageFile.name}-${imageIdx}`} style={{ position: "relative" }}>
											<img
												src={URL.createObjectURL(imageFile)}
												alt={`Selected image ${imageIdx + 1}`}
												style={{ maxHeight: "80px", borderRadius: "6px", objectFit: "contain" }}
											/>
											<button
												onClick={() =>
													setChatImages((prev) => prev.filter((_, idxToKeep) => idxToKeep !== imageIdx))
												}
												className="chat-image-clear"
												title="Remove image"
											>
												×
											</button>
										</div>
									))}
								</div>
							)}
							{editingMessageIdx !== null && (
								<div className="chat-editing-indicator">
									<PenIcon size={12} />
									<span>Editing message</span>
									<button
										onClick={() => {
											setEditingMessageIdx(null);
											editingMessageIdxRef.current = null;
											setChatInput("");
										}}
									>
										<XIcon size={12} /> Cancel
									</button>
								</div>
							)}
							<div className="chat-input-row">
								{hasVisionAccess && (
									<button
										className="camera-btn"
										onClick={() => fileInputRef.current?.click()}
										title="Attach image"
										aria-label="Attach image"
										style={{ color: chatImages.length > 0 ? "var(--accent-gold, #f5c842)" : "currentColor" }}
									>
										<CameraIcon size={20} />
									</button>
								)}
								<textarea
									ref={textareaRef}
									value={chatInput}
									onChange={(e) => {
										setChatInput(e.target.value);
										e.target.style.height = "auto";
										e.target.style.height = e.target.scrollHeight + "px";
									}}
									onKeyDown={handleChatKeyDown}
									placeholder={
										chemistryMode
											? "Ask about a molecule by name, formula, or ChEMBL ID..."
											: chatMode === "coffee"
												? "Ask about coffee capsules, flavors, or brewing..."
												: "Ask me anything - coffee, tech, science, or just chat..."
									}
									rows={1}
								/>
								<button
									onClick={isTyping ? handleStopGeneration : handleChatSubmit}
									disabled={!isTyping && !chatInput.trim() && chatImages.length === 0}
									className={`send-btn${isTyping ? " stop-btn" : ""}`}
									title={isTyping ? "Stop generation" : "Send message"}
									aria-label={isTyping ? "Stop generation" : "Send message"}
								>
									{isTyping ? (
										<span
											style={{
												display: "inline-block",
												width: 14,
												height: 14,
												background: "currentColor",
												borderRadius: 2,
											}}
										/>
									) : (
										<SendHorizontalIcon size={18} />
									)}
								</button>
							</div>
							{hasVisionAccess && (
								<div
									style={{
										marginTop: "0.35rem",
										fontSize: "0.76rem",
										color: "rgba(250, 204, 144, 0.62)",
									}}
								>
									{visionUploadPolicyHint}
								</div>
							)}
							<input
								ref={fileInputRef}
								type="file"
								multiple={maxImagesPerPrompt > 1}
								accept=".webp,.png,.avif,.tif,.tiff,.svg,.jpg,.jpeg,.heic,image/webp,image/png,image/avif,image/tiff,image/svg+xml,image/jpeg,image/heic"
								style={{ display: "none" }}
								onChange={(e) => {
									const files = Array.from(e.target.files || []);
									void handleVisionFileSelection(files.length > 0 ? files : null);
									e.target.value = "";
								}}
							/>
						</div>
						<div className="recommender-cta">
							<button onClick={startNewChat}>
								<RefreshIcon size={16} className="inline mr-1" /> New Chat
							</button>
							<button
								onClick={() => {
									saveCurrentChat();
									setStep("history");
								}}
							>
								<HistoryCircleIcon size={16} /> History
							</button>
							<button onClick={() => setStep("greeting")}>Back</button>
						</div>

						{/* Prompt usage counter */}
						{promptsLimit !== null && (
							<div className="kafelot-prompt-counter">
								{promptsRemaining !== null && promptsRemaining > 0 ? (
									<span>
										{promptsRemaining} / {promptsLimit}{" "}
										{chemistryMode ? "Molecule Helper prompts" : "prompts"} remaining this month
									</span>
								) : (
									<span className="limit-hit">
										{chemistryMode ? "Molecule Helper prompt limit reached" : "Prompt limit reached"} — resets{" "}
										{promptResetDate
											? new Date(promptResetDate).toLocaleDateString("en-US", {
													month: "long",
													day: "numeric",
												})
											: "next month"}
									</span>
								)}
							</div>
						)}

						{/* Disclaimer */}
						<div className="kafelot-disclaimer">
							Kafelot is AI and can make mistakes, including about people.{" "}
							<a href="/kafelot-privacy" target="_blank" rel="noopener noreferrer">
								Your privacy &amp; Kafelot
							</a>
						</div>
					</div>
				)}

				{step === "history" && (
					<div className="recommender-history">
						<h3 style={{ margin: "0 0 12px 0", fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
							Chat History <ClockIcon size={18} />
						</h3>
						{!isLoggedIn ? (
							<div style={{ textAlign: "center", padding: "2rem 1rem" }}>
								<div
									style={{
										color: "rgba(250, 204, 144, 0.8)",
										fontSize: "1.1rem",
										margin: "0 0 0.5rem 0",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										gap: "8px",
									}}
								>
									<LockIcon size={20} /> Chat history is locked
								</div>
								<p style={{ color: "rgba(250, 204, 144, 0.6)", fontSize: "0.9rem", margin: 0 }}>
									Please log in to access your saved conversations
								</p>
							</div>
						) : chatHistory.length === 0 ? (
							<p style={{ textAlign: "center", color: "rgba(248, 220, 204, 0.6)" }}>
								No saved chats yet. Start a conversation to create history!
							</p>
						) : (
							<div className="history-list">
								{chatHistory.map((chat) => (
									<div key={chat.id} className="history-item">
										<div className="history-preview" onClick={() => loadChat(chat.id)}>
											<div className="history-text">{chat.preview}</div>
											<div className="history-date">
												{new Date(chat.timestamp).toLocaleDateString()}{" "}
												{new Date(chat.timestamp).toLocaleTimeString([], {
													hour: "2-digit",
													minute: "2-digit",
												})}
											</div>
										</div>
										<button
											className="history-delete"
											onClick={() => deleteChat(chat.id)}
											aria-label="Delete chat"
										>
											<TrashIcon size={16} />
										</button>
									</div>
								))}
							</div>
						)}
						<div className="recommender-cta">
							<button onClick={() => setStep("greeting")}>Back</button>
						</div>
					</div>
				)}

				{step === "stats" && (
					<div className="recommender-stats">
						<h3 style={{ margin: "0 0 12px 0", fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
							Your Kafelot Stats <ChartBarIcon size={18} />
						</h3>
						<KafelotStats stats={stats} />
						<KafelotUsage stats={stats} />
						<div className="recommender-cta">
							<button onClick={() => setStep("greeting")}>Back</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);

	return (
		<>
			<button
				className={`recommender-launcher ${open ? "active" : ""}`}
				aria-expanded={open}
				aria-controls="recommender-window"
				onClick={() => setOpen((v) => !v)}
				title="Kafelot - Your coffee pilot explorer"
			>
				<GithubCopilotIcon size={24} />
			</button>
			{mounted ? createPortal(dock, document.body) : null}
			{mediaLightbox && (
				<div className="chat-media-lightbox-backdrop" onClick={() => setMediaLightbox(null)} role="presentation">
					<div
						className="chat-media-lightbox-dialog"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-label={mediaLightbox.title || "Media preview"}
					>
						<button
							type="button"
							className="chat-media-lightbox-close"
							onClick={() => setMediaLightbox(null)}
							aria-label="Close preview"
						>
							<XIcon size={18} />
						</button>
						<div className="chat-media-lightbox-content">
							{mediaLightbox.type === "image" ? (
								<img
									src={mediaLightbox.src}
									alt={mediaLightbox.title || "Preview"}
									className="chat-media-lightbox-image"
								/>
							) : (
								<iframe
									srcDoc={mediaLightbox.src}
									className="chat-media-lightbox-iframe"
									title={mediaLightbox.title || "3D preview"}
									sandbox="allow-scripts"
									loading="lazy"
								/>
							)}
						</div>
					</div>
				</div>
			)}
			{selectedProduct && (
				<AddCapsulesPopup
					open={popupOpen}
					productName={selectedProduct.name}
					defaultValue={10}
					onClose={() => {
						setPopupOpen(false);
						setSelectedProduct(null);
					}}
					onConfirm={handleConfirmCapsules}
				/>
			)}
		</>
	);
});
