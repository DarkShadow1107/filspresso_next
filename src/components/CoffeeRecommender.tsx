"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import useCart from "@/hooks/useCart";
import type { CoffeeProduct } from "@/data/coffee";
import { useCoffeeCollections } from "@/hooks/useCoffeeCollections";
import { useNotifications } from "@/components/NotificationsProvider";
import AddCapsulesPopup from "@/components/AddCapsulesPopup";
import {
	smartSearchMolecule,
	getMoleculeVisualization,
	isMoleculeQuery,
	extractMoleculeQuery,
	getMoleculeCard,
} from "@/lib/moleculeSearch";
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
	CpuIcon,
	InfoCircleIcon,
	ArrowNarrowDownIcon,
	ShoppingCartIcon,
	CoffeeIcon,
	BrandGrokIcon,
	BrandOllamaIcon,
	BrandAnthropicIcon,
	LogoutIcon,
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

type Message = { role: "user" | "assistant"; content: string; products?: CoffeeProduct[]; image?: string };
type ChatHistory = {
	id: string;
	timestamp: number;
	messages: Message[];
	preview: string;
	model: "tanka";
	category: "coffee" | "chemistry" | "general";
};

const STORAGE_KEY = "coffee-recommender-history";
const MAX_HISTORY = 50; // Increased history limit

function loadChatHistory(): ChatHistory[] {
	// Chat history is now loaded from the server, not localStorage
	return [];
}

async function saveChatHistory(history: ChatHistory[]) {
	if (typeof window === "undefined") return;
	try {
		// Save to server only
		await fetch("/api/chat/save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ history }),
		});
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
	const [chatMode, setChatMode] = useState<"coffee" | "general">("coffee");
	const [selectedModel, setSelectedModel] = useState<"tanka">("tanka");
	const [chemistryMode, setChemistryMode] = useState(false);
	const [useTankaModel, setUseTankaModel] = useState(false); // Toggle Tanka model ON/OFF in chemistry mode
	const [visualizationMode, setVisualizationMode] = useState<"text" | "2d" | "3d" | "both">("both");
	const [currentMolecule, setCurrentMolecule] = useState<{
		chembl_id: string;
		name: string;
		svg?: string;
		sdf?: string;
		[key: string]: any;
	} | null>(null);
	const [smarterAIAvailable, setSmarterAIAvailable] = useState(false);
	const [isLoggedIn, setIsLoggedIn] = useState(false); // User login state
	const [userSubscription, setUserSubscription] = useState<"none" | "free" | "basic" | "plus" | "pro" | "max" | "ultimate">(
		"free",
	);
	const [isTyping, setIsTyping] = useState(false);
	const abortControllerRef = useRef<AbortController | null>(null);
	const currentRequestIdRef = useRef<string | null>(null);
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

	async function fetchPromptStatus(token?: string) {
		try {
			const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
			const fp = getOrCreateFingerprint();
			fingerprintRef.current = fp;
			const headers: Record<string, string> = { "x-kafelot-fingerprint": fp };
			if (token) headers["authorization"] = `Bearer ${token}`;
			const res = await fetch(`${API_BASE}/api/kafelot/status`, { headers });
			if (res.ok) {
				const data = (await res.json()) as { prompts_remaining: number; prompts_limit: number; reset_date?: string };
				setPromptsRemaining(data.prompts_remaining);
				setPromptsLimit(data.prompts_limit);
				setPromptResetDate(data.reset_date ?? null);
				setLimitReached(data.prompts_remaining <= 0);
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
				const session = sessionStorage.getItem("account_session");
				const storedIsLoggedIn = !!session;
				setIsLoggedIn(storedIsLoggedIn);

				// Fetch subscription from DB via /api/subscriptions if logged in
				if (session) {
					const { token } = JSON.parse(session);
					if (token) {
						// Fetch prompt status with the user's token
						fetchPromptStatus(token);
						// Primary: Fetch subscription tier from subscriptions API (database)
						fetch("http://localhost:4000/api/subscriptions", {
							headers: { Authorization: `Bearer ${token}` },
						})
							.then((res) => res.json())
							.then((data) => {
								const tier = data.subscription?.tier?.toLowerCase() || "free";
								setUserSubscription(tier as "none" | "free" | "basic" | "plus" | "pro" | "max" | "ultimate");

								// All tiers use Kafelot Tanka exclusively
								setSelectedModel("tanka");
							})
							.catch(() => {
								// Fallback to /api/auth/me if subscriptions API fails
								fetch("http://localhost:4000/api/auth/me", {
									headers: { Authorization: `Bearer ${token}` },
								})
									.then((res) => res.json())
									.then((data) => {
										const sub = data.user?.subscription_name?.toLowerCase() || "none";
										setUserSubscription(sub as "none" | "basic" | "plus" | "pro" | "max" | "ultimate");
										// All tiers use Kafelot Tanka exclusively
										setSelectedModel("tanka");
									})
									.catch(() => {
										setUserSubscription("none");
										setSelectedModel("tanka");
									});
							});
					}
				}
			} catch {
				// ignore errors
			}
			// Load prompt status for anonymous users (no session)
			const sessionForFp = sessionStorage.getItem("account_session");
			if (!sessionForFp) {
				fetchPromptStatus();
			}
			// Load chat history only if logged in
			const session = sessionStorage.getItem("account_session");
			if (session) {
				// Load from server
				fetch("/api/chat/save")
					.then((res) => res.json())
					.then((data) => {
						if (data.history && Array.isArray(data.history)) {
							setChatHistory(data.history);
						}
					})
					.catch(() => {
						// ignore
					});
			}
		}
	}, []);

	// Disable chemistry mode if user switches away from Tanka
	useEffect(() => {
		if (chemistryMode && selectedModel !== "tanka") {
			setChemistryMode(false);
			setCurrentMolecule(null);
		}
	}, [selectedModel, chemistryMode]);

	useEffect(() => {
		// close on Escape
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

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
			for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
				const healthy = await checkHealth();
				if (cancelled || healthy) {
					break;
				}
				if (attempt < 2) {
					await wait(4000);
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
			if (!scrollEl || Math.abs(velocity) < 0.5) {
				velocity = 0;
				rafId = null;
				return;
			}
			scrollEl.scrollTop += velocity;
			velocity *= 0.92; // friction for smooth deceleration
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
			velocity += e.deltaY * 0.6;
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

		const chat: ChatHistory = {
			id: currentChatId || `chat-${Date.now()}`,
			timestamp: Date.now(),
			messages: chatMessages,
			preview,
			model: selectedModel,
			category: category,
		};
		const updated = [chat, ...chatHistory.filter((c) => c.id !== chat.id)];
		setChatHistory(updated);
		saveChatHistory(updated);
		setCurrentChatId(chat.id);
	}, [isLoggedIn, chatMessages, currentChatId, chatHistory, selectedModel, chemistryMode, chatMode]);

	// Auto-save chat when messages change (debounced, only if logged in)
	useEffect(() => {
		if (!isLoggedIn || chatMessages.length === 0 || step !== "chat") return;
		const timer = setTimeout(() => {
			saveCurrentChat();
		}, 2000); // save 2 seconds after last message
		return () => clearTimeout(timer);
	}, [isLoggedIn, chatMessages, step, saveCurrentChat]);

	// Start a new chat
	const startNewChat = useCallback(() => {
		saveCurrentChat();
		setChatMessages([]);
		setCurrentChatId(null);
		setChatInput("");
		setStep("chat");
	}, [saveCurrentChat]);

	// Load a chat from history
	const loadChat = useCallback(
		(chatId: string) => {
			const chat = chatHistory.find((c) => c.id === chatId);
			if (!chat) return;
			setChatMessages(chat.messages);
			setCurrentChatId(chat.id);
			setStep("chat");
		},
		[chatHistory],
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
		async (chemblId: string) => {
			try {
				// Fetch molecule details
				const detailsRes = await fetch(`http://localhost:5000/api/molecule/${chemblId}`);
				if (!detailsRes.ok) {
					throw new Error(`Failed to fetch molecule details: ${detailsRes.statusText}`);
				}
				const detailsData = await detailsRes.json();

				const molecule = detailsData.molecule;

				// Fetch SVG if needed
				let svgData: string | undefined;
				if (visualizationMode === "2d" || visualizationMode === "both") {
					try {
						const svgRes = await fetch(`http://localhost:5000/api/molecule/svg/${chemblId}`);
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
						const sdfRes = await fetch(`http://localhost:5000/api/molecule/sdf/${chemblId}`);
						if (sdfRes.ok) {
							sdfData = await sdfRes.text();
						}
					} catch (error) {
						console.warn("Failed to fetch SDF:", error);
					}
				}

				setCurrentMolecule({
					...molecule,
					svg: svgData,
					sdf: sdfData,
				});

				return molecule;
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
		const prompt = chatInput.trim();
		if (!prompt && !chatImage) return;

		// Check prompt limit before sending
		if (limitReached) {
			const resetText = promptResetDate
				? ` Your limit resets on ${new Date(promptResetDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
				: " Your limit resets next month.";
			const limitMsg: Message = {
				role: "assistant",
				content: `⚠️ You have reached your prompt limit for this month.${resetText} Please upgrade your subscription or wait for the reset.`,
			};
			setChatMessages((m) => [...m, limitMsg]);
			return;
		}

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

		// Chemistry mode: Molecule Viewer (when Tanka is OFF)
		// Skip chat entirely, just show molecules from local JSON + API visualizations
		if (
			chemistryMode &&
			!useTankaModel &&
			(lowerPrompt.includes("show") ||
				lowerPrompt.includes("display") ||
				lowerPrompt.includes("structure") ||
				lowerPrompt.includes("molecule") ||
				lowerPrompt.includes("chembl"))
		) {
			try {
				setIsTyping(true);

				// Extract ChEMBL ID or molecule name
				const chemblIdMatch = prompt.match(/CHEMBL\d+/i);
				if (chemblIdMatch) {
					const chemblId = chemblIdMatch[0].toUpperCase();
					const fallbackMol = await smartSearchMolecule(chemblId);
					if (fallbackMol && fallbackMol.chembl_id === chemblId.toUpperCase()) {
						// Get visualizations from Python API (RDKit + Py3Dmol + Pillow)
						const viz = await getMoleculeVisualization(chemblId, visualizationMode, true);
						setCurrentMolecule({
							...fallbackMol,
							svg: viz.svg,
							sdf: viz.sdf,
						});

						const molCard = getMoleculeCard(fallbackMol);
						const responseMsg: Message = {
							role: "assistant",
							content: `🔍 **Found molecule:**\n\n${molCard}\n\n✨ Visualization loaded using RDKit, Py3Dmol, and Pillow.`,
						};
						setChatMessages((m) => [...m, responseMsg]);
					} else {
						const errorMsg: Message = {
							role: "assistant",
							content: `❌ Could not find molecule ${chemblId}. Try another ChEMBL ID or molecule name.`,
						};
						setChatMessages((m) => [...m, errorMsg]);
					}
				} else {
					// Search by name
					const nameMatch = prompt.match(
						/(?:show|display|find|search)\s+(?:me\s+)?(?:the\s+)?(?:molecule\s+)?(.+?)(?:\s+molecule|\s+structure)?$/i,
					);
					if (nameMatch) {
						const moleculeName = nameMatch[1].trim();
						const fallbackMol = await smartSearchMolecule(moleculeName);
						if (fallbackMol) {
							// Get visualizations from Python API
							const viz = await getMoleculeVisualization(fallbackMol.chembl_id, visualizationMode, true);
							setCurrentMolecule({
								...fallbackMol,
								svg: viz.svg,
								sdf: viz.sdf,
							});

							const molCard = getMoleculeCard(fallbackMol);
							const responseMsg: Message = {
								role: "assistant",
								content: `🔍 **Found molecule:**\n\n${molCard}\n\n✨ Visualization loaded using RDKit, Py3Dmol, and Pillow.`,
							};
							setChatMessages((m) => [...m, responseMsg]);
						} else {
							const errorMsg: Message = {
								role: "assistant",
								content: `❌ Could not find molecule "${moleculeName}". Try a common compound like "caffeine" or use a ChEMBL ID.`,
							};
							setChatMessages((m) => [...m, errorMsg]);
						}
					}
				}
				setIsTyping(false);
				return;
			} catch (error) {
				console.error("Molecule viewer error:", error);
				setIsTyping(false);
				const errorMsg: Message = {
					role: "assistant",
					content: "⚠️ Error searching for molecule. Please try again.",
				};
				setChatMessages((m) => [...m, errorMsg]);
				return;
			}
		}

		// When Tanka Model is ON: Let all queries go to the chat API
		// All models now use MiniLM and ResNet-18 via Python backend

		try {
			// Create AbortController for this request
			abortControllerRef.current = new AbortController();

			// Generate unique request ID for server-side cancellation
			const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
			currentRequestIdRef.current = requestId;

			// Use Python chat endpoint for all models (MiniLM / CLIP / MolScribe)
			const shouldUsePython = smarterAIAvailable && (chemistryMode ? useTankaModel : true);
			const endpoint = shouldUsePython ? "/api/python-chat" : "/api/chat";

			let fetchBody: BodyInit;
			let fetchHeaders: Record<string, string> = {};

			// Always include fingerprint for prompt tracking
			const fp = fingerprintRef.current || getOrCreateFingerprint();
			fingerprintRef.current = fp;

			// Include auth token if logged in
			const sessionRaw = typeof window !== "undefined" ? sessionStorage.getItem("account_session") : null;
			const sessionToken = sessionRaw
				? (() => {
						try {
							return JSON.parse(sessionRaw).token as string | undefined;
						} catch {
							return undefined;
						}
					})()
				: undefined;

			if (imageToSend && shouldUsePython) {
				const fd = new FormData();
				fd.append("messages", JSON.stringify([...messagesForApi, userMsg]));
				fd.append("mode", chatMode);
				fd.append("model", selectedModel);
				fd.append("subscription", userSubscription || "");
				fd.append("chemistry_mode", String(chemistryMode && useTankaModel));
				fd.append("request_id", requestId);
				fd.append("image", imageToSend);
				fetchBody = fd;
				if (fp) fetchHeaders["x-kafelot-fingerprint"] = fp;
				if (sessionToken) fetchHeaders["authorization"] = `Bearer ${sessionToken}`;
			} else {
				fetchHeaders = { "Content-Type": "application/json" };
				if (fp) fetchHeaders["x-kafelot-fingerprint"] = fp;
				if (sessionToken) fetchHeaders["authorization"] = `Bearer ${sessionToken}`;
				fetchBody = JSON.stringify({
					messages: [...messagesForApi, userMsg],
					mode: chatMode,
					model: selectedModel,
					subscription: userSubscription,
					chemistry_mode: chemistryMode && useTankaModel,
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
				const errorData = await response.json().catch(() => ({}) as { error?: string; reset_date?: string });
				if (response.status === 429 || errorData.error === "PROMPT_LIMIT_REACHED") {
					setLimitReached(true);
					setPromptsRemaining(0);
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
				throw new Error(errorData.error || `Failed to get response (Status: ${response.status})`);
			}

			const data = await response.json();

			// Check if request was cancelled on the server
			if (data.cancelled) {
				return; // Silently exit, user cancelled
			}

			// Decrement local prompt count after a successful AI response
			setPromptsRemaining((prev) => {
				if (prev === null) return prev;
				const next = Math.max(0, prev - 1);
				if (next <= 0) setLimitReached(true);
				return next;
			});

			const assistantMsg: Message = {
				role: "assistant",
				content: data.response,
				products: data.products || [],
			};

			setChatMessages((m) => [...m, assistantMsg]);
		} catch (error) {
			// Check if it was aborted by user
			if (error instanceof Error && error.name === "AbortError") {
				// User cancelled, don't show error
				return;
			}
			console.error("Chat error:", error);
			const fallbackResponse = generateFallbackResponse(lowerPrompt, chatMode);
			const assistantMsg: Message = {
				role: "assistant",
				content: fallbackResponse.response,
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
		selectedModel,
		userSubscription,
		generateFallbackResponse,
		smarterAIAvailable,
		chemistryMode,
		visualizationMode,
		fetchMoleculeData,
		limitReached,
		promptResetDate,
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
						<p>
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
										<strong>Tip:</strong> Log in to unlock chat history and the Molecule Helper (Ultimate
										subscription)!
									</div>
								</div>
							</div>
						)}
						<div className="recommender-cta recommender-tabs">
							<button onClick={() => setStep("chat")}>
								<MessageCircleIcon className="recommender-inline-icon" /> Chat with me
							</button>
							<button onClick={() => setStep("prefs")}>
								<MagnifierIcon className="recommender-inline-icon" /> Advanced search
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
								<RocketIcon className="recommender-inline-icon" /> Show popular
							</button>
							{isLoggedIn && chatHistory.length > 0 && (
								<button onClick={() => setStep("history")}>
									<HistoryCircleIcon className="recommender-inline-icon" /> Chat history
								</button>
							)}
							{isLoggedIn && (
								<button onClick={() => setStep("stats")}>
									<ChartBarIcon className="recommender-inline-icon" /> Stats
								</button>
							)}
						</div>

						{/* Demo login/logout for testing */}
						<div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid rgba(174, 137, 102, 0.2)" }}>
							<div
								style={{
									fontSize: "0.85rem",
									color: "rgba(250, 204, 144, 0.6)",
									marginBottom: "0.5rem",
									textAlign: "center",
								}}
							>
								Demo Controls (for testing)
							</div>
							{!isLoggedIn ? (
								<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
									<button
										onClick={() => {
											// Demo login - simulate session with max subscription
											sessionStorage.setItem(
												"account_session",
												JSON.stringify({
													username: "demo_max",
													full_name: "Demo Max User",
													email: "demo_max@test.com",
													token: "demo_token_max",
												}),
											);
											setIsLoggedIn(true);
											setUserSubscription("max");
											setSelectedModel("tanka");
										}}
										style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
									>
										Login as Max
									</button>
									<button
										onClick={() => {
											// Demo login - simulate session with ultimate subscription
											sessionStorage.setItem(
												"account_session",
												JSON.stringify({
													username: "demo_ultimate",
													full_name: "Demo Ultimate User",
													email: "demo_ultimate@test.com",
													token: "demo_token_ultimate",
												}),
											);
											setIsLoggedIn(true);
											setUserSubscription("ultimate");
											setSelectedModel("tanka");
										}}
										style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
									>
										Login as Ultimate
									</button>
									<button
										onClick={() => {
											// Demo login - simulate session with basic subscription
											sessionStorage.setItem(
												"account_session",
												JSON.stringify({
													username: "demo_basic",
													full_name: "Demo Basic User",
													email: "demo_basic@test.com",
													token: "demo_token_basic",
												}),
											);
											setIsLoggedIn(true);
											setUserSubscription("basic");
											setSelectedModel("tanka");
										}}
										style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
									>
										Login as Basic
									</button>
								</div>
							) : (
								<button
									onClick={() => {
										sessionStorage.removeItem("account_session");
										setIsLoggedIn(false);
										setUserSubscription("none");
										setSelectedModel("tanka");
										setChatHistory([]);
										setChatMessages([]);
									}}
									style={{
										fontSize: "0.85rem",
										padding: "0.4rem 1rem",
										margin: "0 auto",
										display: "flex",
										alignItems: "center",
										gap: "8px",
										justifyContent: "center",
										borderRadius: "6px",
										backgroundColor: "rgba(255, 120, 120, 0.1)",
										color: "#ff8080",
										border: "1px solid rgba(255, 120, 120, 0.2)",
										cursor: "pointer",
										fontWeight: 600,
										transition: "all 0.2s ease",
									}}
									className="logout-btn-recommender"
								>
									<LogoutIcon size={16} /> Log out
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
									setChatMode("coffee");
									setChemistryMode(false);
								}}
								title="Coffee Helper Mode - Focused on Nespresso recommendations"
							>
								<CoffeeIcon size={16} /> Coffee Helper
							</button>

							<button
								className={chemistryMode ? "active chemistry-mode" : "chemistry-mode"}
								onClick={() => {
									// Molecule Helper requires login + Ultimate subscription
									if (isLoggedIn && userSubscription === "ultimate") {
										setChatMode("general");
										setChemistryMode(!chemistryMode);
									}
								}}
								disabled={!isLoggedIn || userSubscription !== "ultimate"}
								title={
									!isLoggedIn
										? "Molecule Helper - Login required"
										: userSubscription !== "ultimate"
											? "Molecule Helper - Ultimate subscription required 🔒"
											: "Molecule Helper - MolScribe AI molecule visualization (Ultimate)"
								}
							>
								<BrandGrokIcon size={16} /> Molecule Helper{" "}
								{(!isLoggedIn || userSubscription !== "ultimate") && (
									<span style={{ marginLeft: "4px" }}>
										<LockIcon size={14} />
									</span>
								)}
							</button>
						</div>

						{chemistryMode && (
							<>
								<div className="subscription-info-box">
									{!isLoggedIn ? (
										<div className="subscription-notice">
											<p
												style={{
													margin: 0,
													fontSize: "0.95rem",
													color: "rgba(250, 204, 144, 0.8)",
													display: "flex",
													alignItems: "center",
													gap: "0.5rem",
												}}
											>
												<InfoCircleIcon size={16} />{" "}
												<span>
													<strong>Not logged in</strong> - Using Tanka (free)
												</span>
											</p>
											<p
												style={{
													margin: "0.25rem 0 0 0",
													fontSize: "0.85rem",
													color: "rgba(250, 204, 144, 0.6)",
												}}
											>
												Log in to unlock CLIP image search and Molecule Helper
											</p>
										</div>
									) : (
										<div className="subscription-status">
											<p
												style={{
													margin: 0,
													fontSize: "0.95rem",
													color: "rgba(250, 204, 144, 0.8)",
													display: "flex",
													alignItems: "center",
													gap: "0.5rem",
												}}
											>
												<ShoppingCartIcon size={16} />{" "}
												<span>
													<strong>Subscription:</strong>{" "}
													{userSubscription === "none"
														? "None (Tanka only)"
														: userSubscription.charAt(0).toUpperCase() + userSubscription.slice(1)}
												</span>
											</p>
											{userSubscription === "none" ||
											userSubscription === "basic" ||
											userSubscription === "plus" ? (
												<p
													style={{
														margin: "0.25rem 0 0 0",
														fontSize: "0.85rem",
														color: "rgba(250, 204, 144, 0.6)",
													}}
												>
													Upgrade to Pro or above for CLIP image search
												</p>
											) : null}
										</div>
									)}
								</div>

								<div className="model-selector">
									<label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
										<CpuIcon size={16} /> AI Model:
									</label>
									<button
										className="active"
										title="Kafelot Tanka - Lightweight & Fast. Coffee-focused recommendations with instant responses."
									>
										<span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
											<BrandAnthropicIcon size={16} />
										</span>
										Kafelot Tanka
									</button>
								</div>

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
									</div>
								)}

								{chemistryMode && (
									<div className="tanka-model-toggle-section" style={{ marginTop: "1rem" }}>
										<label
											style={{
												display: "flex",
												alignItems: "center",
												gap: "0.5rem",
												marginBottom: "0.5rem",
											}}
										>
											<GithubCopilotIcon size={16} /> Tanka AI Model:
										</label>
										<button
											className={useTankaModel ? "active tanka-model-toggle" : "tanka-model-toggle"}
											onClick={() => {
												if (isLoggedIn && userSubscription === "ultimate") {
													setUseTankaModel(!useTankaModel);
												}
											}}
											disabled={!isLoggedIn || userSubscription !== "ultimate"}
											title={
												!isLoggedIn
													? "Use Tanka Model - Login required"
													: userSubscription !== "ultimate"
														? "Use Tanka Model - Ultimate subscription required 🔒"
														: useTankaModel
															? "Tanka Model ON - Chemistry chat with AI"
															: "Tanka Model OFF - Pure molecule visualization only"
											}
											style={{
												padding: "0.5rem 1rem",
												borderRadius: "6px",
												border: `2px solid ${useTankaModel ? "#4CAF50" : "#888"}`,
												background: useTankaModel ? "rgba(76, 175, 80, 0.15)" : "transparent",
												color: useTankaModel ? "#4CAF50" : "inherit",
												cursor:
													!isLoggedIn || userSubscription !== "ultimate" ? "not-allowed" : "pointer",
												opacity: !isLoggedIn || userSubscription !== "ultimate" ? 0.5 : 1,
												width: "100%",
											}}
										>
											{useTankaModel
												? "Tanka Model ON (Chemistry Chat)"
												: "Visualization Only (No AI Chat)"}
											{(!isLoggedIn || userSubscription !== "ultimate") && (
												<LockIcon size={14} className="inline ml-1" />
											)}
										</button>
										{!useTankaModel && (
											<div
												style={{
													fontSize: "0.85rem",
													color: "rgba(250, 204, 144, 0.7)",
													marginTop: "0.5rem",
													display: "flex",
													alignItems: "center",
													gap: "0.25rem",
												}}
											>
												<BulbSvg size={14} className="inline-flex" />
												<span>Uses RDKit, Py3Dmol, and Pillow for molecule visualization</span>
											</div>
										)}
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
												<BrandAnthropicIcon size={16} /> Kafelot Tanka
											</div>
											<p>
												Lightweight &amp; Fast. Perfect for quick coffee searches. Focuses on Nespresso
												capsule recommendations with instant responses.
											</p>
										</div>
									)}
								</div>
							</>
						)}

						<div className="chat-messages">
							{chatMessages.length === 0 && (
								<div className="chat-welcome">
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
							{chatMessages.map((msg, idx) => (
								<div key={idx} className={`chat-message ${msg.role}`}>
									{msg.role === "assistant" && (
										<div className="chat-avatar">
											<GithubCopilotIcon size={20} />
										</div>
									)}
									{msg.role === "user" && msg.image && (
										<div className="chat-bubble-image">
											<img src={msg.image} alt="Attached image" />
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
										</>
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
															isOutOfStock ? { opacity: 0.5, filter: "grayscale(50%)" } : undefined
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
																...(isOutOfStock ? { opacity: 0.5, cursor: "not-allowed" } : {}),
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
							))}
							{isTyping && (
								<div className="chat-message assistant">
									<div className="chat-bubble typing">
										<span></span>
										<span></span>
										<span></span>
									</div>
								</div>
							)}

							{chemistryMode && currentMolecule && (
								<div className="molecule-display">
									<div className="molecule-header">
										<h3>
											<SparklesIcon size={20} className="inline mr-2" />{" "}
											{currentMolecule.name || currentMolecule.chembl_id}
										</h3>
										<button
											className="close-molecule"
											onClick={() => setCurrentMolecule(null)}
											title="Close molecule view"
											style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
										>
											<XIcon size={18} />
										</button>
									</div>

									<div className="molecule-info">
										<p>
											<strong>ChEMBL ID:</strong> {currentMolecule.chembl_id}
										</p>
										{currentMolecule.molecular_formula && (
											<p>
												<strong>Formula:</strong> {currentMolecule.molecular_formula}
											</p>
										)}
										{currentMolecule.molecular_weight && (
											<p>
												<strong>Weight:</strong> {currentMolecule.molecular_weight.toFixed(2)} g/mol
											</p>
										)}
										{currentMolecule.smiles && (
											<p style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
												<strong>SMILES:</strong> {currentMolecule.smiles}
											</p>
										)}
									</div>

									{(visualizationMode === "2d" || visualizationMode === "both") && currentMolecule.svg && (
										<div
											className="molecule-2d"
											style={{
												padding: "1rem",
												borderRadius: "8px",
												background: "#1a1a1a",
												border: "1px solid rgba(255, 255, 255, 0.1)",
											}}
										>
											<h4>2D Structure</h4>
											{currentMolecule.svg.startsWith("data:") ? (
												// SVG as base64 data URL - display as image
												<img
													src={currentMolecule.svg}
													alt="2D Structure"
													style={{
														maxWidth: "100%",
														height: "auto",
														borderRadius: "4px",
													}}
												/>
											) : (
												// SVG as HTML content
												<div
													className="svg-container"
													dangerouslySetInnerHTML={{ __html: currentMolecule.svg }}
												/>
											)}
										</div>
									)}

									{(visualizationMode === "3d" || visualizationMode === "both") && currentMolecule.sdf && (
										<div className="molecule-3d">
											<h4>3D Interactive Model</h4>
											{currentMolecule.sdf.includes("<script") ||
											currentMolecule.sdf.includes("<!DOCTYPE") ? (
												// Py3Dmol HTML viewer - render in iframe for safety
												<iframe
													srcDoc={currentMolecule.sdf}
													style={{
														width: "100%",
														height: "500px",
														border: "1px solid rgba(255, 255, 255, 0.1)",
														borderRadius: "8px",
														background: "#1a1a1a",
													}}
													title="3D Molecule Viewer"
													sandbox="allow-scripts"
													loading="lazy"
												/>
											) : (
												// Fallback: SDF data for download
												<div className="sdf-info">
													<div
														style={{
															display: "flex",
															alignItems: "center",
															gap: "0.5rem",
															marginBottom: "0.5rem",
														}}
													>
														<ArrowNarrowDownIcon size={18} />
														<span>
															<strong>SDF Data Available</strong> - Use PyMOL or similar tools to
															visualize
														</span>
													</div>
													<button
														onClick={() => {
															const blob = new Blob([currentMolecule.sdf || ""], {
																type: "chemical/x-mdl-sdfile",
															});
															const url = URL.createObjectURL(blob);
															const a = document.createElement("a");
															a.href = url;
															a.download = `${currentMolecule.chembl_id}.sdf`;
															a.click();
															URL.revokeObjectURL(url);
														}}
														className="download-sdf-btn"
														style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
													>
														<ArrowNarrowDownIcon size={16} /> Download SDF
													</button>
													<pre className="sdf-preview">{currentMolecule.sdf?.substring(0, 500)}...</pre>
												</div>
											)}
										</div>
									)}
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
										chatMode === "coffee"
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
										{promptsRemaining} / {promptsLimit} prompts remaining this month
									</span>
								) : (
									<span className="limit-hit">
										Prompt limit reached — resets{" "}
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
								<p
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
								</p>
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
