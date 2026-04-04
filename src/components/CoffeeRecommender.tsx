"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import useCart from "@/hooks/useCart";
import type { CoffeeProduct } from "@/data/coffee";
import { useCoffeeCollections } from "@/hooks/useCoffeeCollections";
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
	[key: string]: any;
};

type Message = {
	role: "user" | "assistant";
	content: string;
	products?: CoffeeProduct[];
	image?: string;
	modelUsed?: string;
	molecule?: MoleculeMessageView;
};

type StylizedModelInfo = {
	label: string;
	accent: "qwen" | "minilm" | "molscribe" | "clip" | "tanka";
};

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

	if (normalized.includes("molscribe") || normalized.includes("swin_base")) {
		return { label: "MolScribe", accent: "molscribe" };
	}
	if (normalized.includes("clip")) {
		return { label: "CLIP Vision", accent: "clip" };
	}
	if (normalized.includes("qwen3") && normalized.includes("unavailable")) {
		return { label: "Qwen 3 (Unavailable)", accent: "qwen" };
	}
	if (normalized.includes("qwen3") && normalized.includes("unauthorized")) {
		return { label: "Qwen 3 (Locked)", accent: "qwen" };
	}
	if (normalized.includes("qwen3-local") && normalized.includes("thinking")) {
		return { label: "Qwen 3 Thinking", accent: "qwen" };
	}
	if (normalized.includes("qwen3")) {
		return { label: "Qwen 3 0.6B", accent: "qwen" };
	}
	if (normalized.includes("minilm")) {
		if (normalized.includes("fallback")) {
			return { label: "MiniLM (Fallback)", accent: "minilm" };
		}
		return { label: "MiniLM", accent: "minilm" };
	}

	return { label: "Kafelot Tanka", accent: "tanka" };
}

type ChatHistory = {
	id: string;
	timestamp: number;
	messages: Message[];
	preview: string;
	model: "tanka";
	category: "coffee" | "chemistry" | "general";
};

type HelperMode = "coffee_helper" | "molecule_helper";
type HelperConversationSnapshot = {
	chatId: string | null;
	messages: Message[];
};

type UserSubscriptionTier = "none" | "free" | "basic" | "plus" | "pro" | "max" | "ultimate";

const KNOWN_SUBSCRIPTION_TIERS = new Set<UserSubscriptionTier>(["none", "free", "basic", "plus", "pro", "max", "ultimate"]);

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

function expectedPromptLimit(tier: UserSubscriptionTier, scope: "general" | "molecule_helper", loggedIn: boolean): number {
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
	scope: "general" | "molecule_helper",
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

export default function CoffeeRecommender() {
	const allProducts = useAllProducts();
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
	const [selectedModel, setSelectedModel] = useState<"tanka">("tanka");
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
	const moleculeVizCacheRef = useRef<Record<string, { molecule: any; svg?: string; sdf?: string }>>({});
	const [chatImage, setChatImage] = useState<File | null>(null);

	// Prompt limit tracking
	const [promptsRemaining, setPromptsRemaining] = useState<number | null>(null);
	const [promptsLimit, setPromptsLimit] = useState<number | null>(null);
	const [promptResetDate, setPromptResetDate] = useState<string | null>(null);
	const [limitReached, setLimitReached] = useState(false);
	const fingerprintRef = useRef<string>("");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const recommenderRef = useRef<HTMLDivElement>(null);
	const editingMessageIdxRef = useRef<number | null>(null);
	const lastSavedConversationSignatureRef = useRef<string>("");
	const [editingMessageIdx, setEditingMessageIdx] = useState<number | null>(null);
	const { addItem } = useCart();
	const { notify } = useNotifications();

	// Stock data for products
	const [stockData, setStockData] = useState<StockData>({});

	const allNotes = useMemo(() => {
		const set = new Set<string>();
		allProducts.forEach((p) => p.notes?.forEach((n) => set.add(n)));
		return Array.from(set).sort();
	}, []);

	const stats = useMemo(() => {
		const categoryCounts = { coffee: 0, chemistry: 0, general: 0 };
		const modelCounts = { tanka: 0 };
		const total = chatHistory.length;

		chatHistory.forEach((chat) => {
			if (chat.category) categoryCounts[chat.category]++;
			else categoryCounts.general++;

			modelCounts.tanka++;
		});

		const modelPercentages = {
			tanka: total ? 100 : 0,
		};

		return { categoryCounts, modelCounts, modelPercentages, total };
	}, [chatHistory]);

	const hasQwenAccess = useMemo(() => ["pro", "max", "ultimate"].includes(userSubscription), [userSubscription]);
	const hasQwenThinkingAccess = useMemo(() => userSubscription === "ultimate", [userSubscription]);
	const activeHelperMode: HelperMode = chemistryMode ? "molecule_helper" : "coffee_helper";
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

	async function fetchPromptStatus(token?: string, scope: "general" | "molecule_helper" = "general") {
		try {
			const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
			const normalizedScope = scope === "molecule_helper" ? "molecule_helper" : "general";
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

				setPromptsRemaining(normalizedCounters.promptsRemaining);
				setPromptsLimit(normalizedCounters.promptsLimit);
				setPromptResetDate(data.reset_date ?? null);
				setLimitReached(normalizedCounters.promptsRemaining <= 0);
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
				const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
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
			} catch (error) {
				console.warn("Coffee stock endpoint unavailable for recommender.");
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
						const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
						const authHeaders = { Authorization: `Bearer ${token}` };
						const expireSession = () => {
							clearAccountSession();
							setIsLoggedIn(false);
							setUserSubscription("none");
							setSelectedModel("tanka");
							fetchPromptStatus(undefined, "general");
						};

						// Fetch prompt status with the user's token
						fetchPromptStatus(token, "general");
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

								// All tiers use Kafelot Tanka exclusively
								setSelectedModel("tanka");
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
										// All tiers use Kafelot Tanka exclusively
										setSelectedModel("tanka");
									})
									.catch((authError) => {
										if ((authError as Error)?.message === "AUTH_EXPIRED") {
											expireSession();
											return;
										}
										const sessionTier = normalizeUserSubscriptionTier(accountSession.subscription, "free");
										setUserSubscription(sessionTier);
										setSelectedModel("tanka");
									});
							});
					}
				}
			} catch {
				// ignore errors
			}
			// Load prompt status for anonymous users (no session)
			const accountSessionForFp = readAccountSession();
			if (!accountSessionForFp) {
				fetchPromptStatus(undefined, "general");
			}
			// Load chat history only if logged in
			const accountSessionForHistory = readAccountSession();
			if (accountSessionForHistory) {
				// Load from server
				fetch("/api/chat/save")
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
		const scope = chemistryMode ? "molecule_helper" : "general";
		fetchPromptStatus(token, scope);
	}, [chemistryMode, isLoggedIn, userSubscription]);

	useEffect(() => {
		const activeHelper: HelperMode = chemistryMode ? "molecule_helper" : "coffee_helper";
		helperConversationsRef.current[activeHelper] = {
			chatId: currentChatId,
			messages: [...chatMessages],
		};
	}, [chatMessages, currentChatId, chemistryMode]);

	// Disable chemistry mode if user switches away from Tanka
	useEffect(() => {
		if (chemistryMode && selectedModel !== "tanka") {
			setChemistryMode(false);
		}
	}, [selectedModel, chemistryMode]);

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
				const res = await fetch("/api/python-health");
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
			setChatImage(null);
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
		setChatImage(null);
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
			setChatImage(null);
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
		async (moleculeIdentifier: string, fallbackMolecule?: Record<string, any>) => {
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

				let molecule = fallbackMolecule ?? null;
				if (!molecule) {
					const detailsRes = await fetch(`/api/molecule/${encodedIdentifier}`);
					if (!detailsRes.ok) {
						throw new Error(`Failed to fetch molecule details: ${detailsRes.statusText}`);
					}
					const detailsData = await detailsRes.json();
					molecule = detailsData.molecule;
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
		if (!prompt && !chatImage) return;

		const imageDataUrl = await new Promise<string | null>((resolve) => {
			if (!chatImage) {
				resolve(null);
				return;
			}
			const reader = new FileReader();
			reader.onloadend = () => resolve(reader.result as string);
			reader.onerror = () => resolve(null);
			reader.readAsDataURL(chatImage);
		});
		const userMsg: Message = {
			role: "user",
			content: prompt || (imageDataUrl ? "" : "[Image attached]"),
			...(imageDataUrl ? { image: imageDataUrl } : {}),
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
		const imageToSend = chatImage;
		setChatImage(null);
		setIsTyping(true);

		const lowerPrompt = prompt.toLowerCase();
		const moleculeRequested =
			chemistryMode && (isMoleculeQuery(prompt) || /CHEMBL\d+/i.test(prompt) || !!extractMoleculeQuery(prompt));
		const helperModeForPrompt: HelperMode = chemistryMode ? "molecule_helper" : "coffee_helper";
		const thinkingToggleEnabled = thinkingEnabledByHelper[helperModeForPrompt];
		const enableThinking = shouldEnableThinkingForPrompt(prompt, hasQwenThinkingAccess, thinkingToggleEnabled);

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
			const promptScope: "general" | "molecule_helper" = chemistryMode ? "molecule_helper" : "general";

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

				if (
					errorData.error === "QWEN_THINKING_UNAVAILABLE" ||
					errorData.error === "MOLSCRIBE_UNAVAILABLE" ||
					isHighDemandUnavailableModel(errorData.model_used) ||
					String(errorData.message || "")
						.toLowerCase()
						.includes("high demand")
				) {
					const unavailableMsg: Message = {
						role: "assistant",
						content:
							errorData.message ||
							(errorData.error === "MOLSCRIBE_UNAVAILABLE"
								? "MolScribe is in high demand right now, we're sorry for unavailability."
								: "Qwen 3 Thinking is in high demand right now, we're sorry for unavailability."),
						modelUsed: errorData.model_used || "qwen3-unavailable-chemistry-high-demand",
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
				setLimitReached(normalizedCounters.promptsRemaining <= 0);
			} else {
				setPromptsRemaining((prev) => {
					if (prev === null) return prev;
					const next = Math.max(0, prev - 1);
					if (next <= 0) setLimitReached(true);
					return next;
				});
			}

			const modelUsedLabel =
				typeof data.model_used === "string" && data.model_used.trim().length > 0
					? data.model_used
					: typeof data.model === "string" && data.model.trim().length > 0
						? data.model
						: "Tanka";
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
				const chemistryUnavailableMsg: Message = {
					role: "assistant",
					content: imageToSend
						? "MolScribe is in high demand right now, we're sorry for unavailability."
						: "Qwen 3 Thinking is in high demand right now, we're sorry for unavailability.",
					modelUsed: imageToSend ? "molscribe-unavailable-high-demand" : "qwen3-unavailable-chemistry-high-demand",
				};
				setChatMessages((m) => [...m, chemistryUnavailableMsg]);
				return;
			}
			const fallbackResponse = generateFallbackResponse(lowerPrompt, chatMode);
			const assistantMsg: Message = {
				role: "assistant",
				content: isTimeoutLikeError
					? "Qwen 3 is taking too long right now, so I switched to a fast MiniLM fallback response.\n\n" +
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
		chatImage,
		chatMessages,
		chatMode,
		userSubscription,
		generateFallbackResponse,
		smarterAIAvailable,
		chemistryMode,
		hasQwenThinkingAccess,
		thinkingEnabledByHelper,
		visualizationMode,
		fetchMoleculeData,
		isTyping,
	]);

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
										<strong>Tip:</strong> Log in to unlock chat history and subscription-based Qwen 3 access
										for Molecule Helper text chemistry.
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
									// Try to fetch popular from API first
									try {
										const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
										const res = await fetch(`${API_BASE}/api/orders/popular?limit=5`);
										if (res.ok) {
											const data = await res.json();
											if (data.products && data.products.length > 0) {
												// Map API products to CoffeeProduct objects
												const popular = data.products
													.map((p: { product_id: string }) =>
														allProducts.find((prod) => prod.id === p.product_id),
													)
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
									hasQwenAccess
										? hasQwenThinkingAccess
											? "Molecule Helper - Text chemistry with Qwen 3 Thinking and image chemistry with MolScribe."
											: "Molecule Helper - Text chemistry with Qwen 3 and image chemistry with MolScribe."
										: "Molecule Helper - Image chemistry with MolScribe. Qwen 3 text chemistry requires PRO, MAX, or ULTIMATE."
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
											{chemistryMode ? (
												hasQwenAccess ? (
													<>
														<span className="model-access-chip qwen">
															<BrandQwenIcon size={13} /> Qwen 3 Access
														</span>
														<span className="model-access-chip molscribe">
															<BrandGrokIcon size={13} /> MolScribe image chemistry
														</span>
													</>
												) : (
													<>
														<span className="model-access-chip molscribe">
															<BrandGrokIcon size={13} /> MolScribe image chemistry
														</span>
														<span className="model-access-chip qwen">
															<LockIcon size={12} /> Qwen 3 text chemistry locked
														</span>
													</>
												)
											) : hasQwenAccess ? (
												<>
													<span className="model-access-chip qwen">
														<BrandQwenIcon size={13} /> Qwen 3 Access
													</span>
													<span className="model-access-chip minilm">
														<BrandGeminiIcon size={13} /> MiniLM access (fallback)
													</span>
												</>
											) : (
												<span className="model-access-chip minilm">
													<BrandGeminiIcon size={13} /> MiniLM access
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
												? hasQwenAccess
													? hasQwenThinkingAccess
														? "Molecule Helper text requests use Qwen 3 access. Turn on Thinking below to enable Qwen 3 Thinking. Uploaded molecule images are analyzed with MolScribe."
														: "Molecule Helper text requests use Qwen 3 access, while uploaded molecule images are analyzed with MolScribe."
													: "Molecule Helper can analyse uploaded molecule images with MolScribe. Qwen 3 text chemistry requires PRO, MAX, or ULTIMATE."
												: hasQwenAccess
													? hasQwenThinkingAccess
														? "ULTIMATE includes Qwen 3 access with optional Thinking mode and MiniLM fallback."
														: "PRO and MAX include Qwen 3 access with MiniLM fallback."
													: "FREE, BASIC and PLUS use Kafelot Tanka with MiniLM only (no Qwen)."}
										</p>
										{!isLoggedIn && (
											<p
												style={{
													margin: "0.25rem 0 0 0",
													fontSize: "0.78rem",
													color: "rgba(250, 204, 144, 0.56)",
												}}
											>
												Log in to unlock subscription-based Qwen 3 chemistry access.
											</p>
										)}
									</div>
								</div>

								<div className="model-selector">
									<label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
										<BrandQwenIcon size={16} /> Thinking (
										{chemistryMode ? "Molecule Helper" : "Coffee Helper"})
									</label>
									<button
										className={thinkingEnabledForActiveHelper ? "active" : ""}
										onClick={toggleThinkingForActiveHelper}
										disabled={!hasQwenThinkingAccess}
										title={
											hasQwenThinkingAccess
												? "Enable or disable Qwen 3 Thinking for this helper."
												: "Thinking mode requires Ultimate subscription."
										}
									>
										<span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
											<BrandQwenIcon size={16} />
										</span>
										{thinkingEnabledForActiveHelper ? "Qwen 3 Thinking ON" : "Qwen 3 Thinking OFF"}
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
										? "Thinking is saved separately for Coffee Helper and Molecule Helper. You can still use /think or /no_think per message."
										: "Thinking mode requires Ultimate subscription."}
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
									{selectedModel === "tanka" && (
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
												{chemistryMode ? (
													<BrandGrokIcon size={16} />
												) : hasQwenAccess ? (
													<BrandQwenIcon size={16} />
												) : (
													<BrandGeminiIcon size={16} />
												)}{" "}
												Kafelot Tanka
											</div>
											<p>
												{chemistryMode
													? hasQwenAccess
														? hasQwenThinkingAccess
															? "In Molecule Helper, text requests use Qwen 3 access and image requests use MolScribe. Turn Thinking on to enable Qwen 3 Thinking."
															: "In Molecule Helper, text requests use Qwen 3 access and image requests use MolScribe."
														: "In Molecule Helper, upload a molecule image to use MolScribe. Qwen 3 text chemistry requires PRO, MAX, or ULTIMATE."
													: hasQwenAccess
														? hasQwenThinkingAccess
															? "Uses Qwen 3 access for primary coffee generation, with optional Thinking mode and MiniLM fallback when needed."
															: "Uses Qwen 3 access for primary coffee generation, with MiniLM fallback when needed."
														: "Uses MiniLM-only coffee generation for this subscription tier."}
											</p>
										</div>
									)}
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
												<span style={{ color: "rgba(250, 204, 144, 0.6)" }}>
													(MolScribe AI — Ultimate)
												</span>
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

								return (
									<div key={idx} className={`chat-message ${msg.role}`}>
										{msg.role === "assistant" && (
											<div className="chat-avatar">
												<GithubCopilotIcon size={20} />
											</div>
										)}
										{msg.role === "user" && msg.image && (
											<div className="chat-bubble-image">
												<img
													src={msg.image}
													alt="Attached image"
													className="chat-clickable-image"
													onClick={() =>
														setMediaLightbox({
															type: "image",
															src: msg.image!,
															title: "Attached image",
														})
													}
												/>
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
															) : stylizedModel.accent === "molscribe" ? (
																<BrandGrokIcon size={12} />
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
							{chatImage && (
								<div className="chat-image-preview">
									<img
										src={URL.createObjectURL(chatImage)}
										alt="Selected image"
										style={{ maxHeight: "80px", borderRadius: "6px", objectFit: "contain" }}
									/>
									<button onClick={() => setChatImage(null)} className="chat-image-clear" title="Remove image">
										×
									</button>
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
								{!["none", "free", "basic", "plus"].includes(userSubscription) && (
									<button
										className="camera-btn"
										onClick={() => fileInputRef.current?.click()}
										title="Attach image"
										aria-label="Attach image"
										style={{ color: chatImage ? "var(--accent-gold, #f5c842)" : "currentColor" }}
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
									disabled={!isTyping && !chatInput.trim() && !chatImage}
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
							<input
								ref={fileInputRef}
								type="file"
								accept="image/*"
								style={{ display: "none" }}
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) setChatImage(file);
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
}
