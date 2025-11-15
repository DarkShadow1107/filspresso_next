"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import useCart from "@/hooks/useCart";
import { coffeeCollections, type CoffeeProduct } from "@/data/coffee";
import { useNotifications } from "@/components/NotificationsProvider";
import AddCapsulesPopup from "@/components/AddCapsulesPopup";
import {
	smartSearchMolecule,
	getMoleculeVisualization,
	isMoleculeQuery,
	extractMoleculeQuery,
	getMoleculeCard,
} from "@/lib/moleculeSearch";

// Memoize product flattening for performance
const allProducts = coffeeCollections.flatMap((c) => c.groups.flatMap((g) => g.products));
const GEMMA_MAX_TOKENS = 768;

type Message = { role: "user" | "assistant"; content: string; products?: CoffeeProduct[] };
type ChatHistory = { id: string; timestamp: number; messages: Message[]; preview: string };

const STORAGE_KEY = "coffee-recommender-history";
const MAX_HISTORY = 10;

function loadChatHistory(): ChatHistory[] {
	if (typeof window === "undefined") return [];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

function saveChatHistory(history: ChatHistory[]) {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
	} catch {
		// ignore storage errors
	}
}

export default function CoffeeRecommender() {
	const [mounted, setMounted] = useState(false);
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<"greeting" | "prefs" | "results" | "chat" | "history">("greeting");
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
	const [selectedModel, setSelectedModel] = useState<"tanka" | "villanelle" | "ode">("tanka");
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
	const [userSubscription, setUserSubscription] = useState<"none" | "basic" | "plus" | "pro" | "max" | "ultimate">("none");
	const [isTyping, setIsTyping] = useState(false);
	const gemmaInstanceRef = useRef<any>(null);
	const gemmaInitPromiseRef = useRef<Promise<void> | null>(null);
	const [gemmaReady, setGemmaReady] = useState(false);
	const [gemmaLoading, setGemmaLoading] = useState(false);
	const [gemmaError, setGemmaError] = useState<string | null>(null);
	const { addItem } = useCart();
	const { notify } = useNotifications();

	const allNotes = useMemo(() => {
		const set = new Set<string>();
		allProducts.forEach((p) => p.notes?.forEach((n) => set.add(n)));
		return Array.from(set).sort();
	}, []);

	const initializeGemma = useCallback(async () => {
		if (gemmaInstanceRef.current) {
			return gemmaInstanceRef.current;
		}

		if (!gemmaInitPromiseRef.current) {
			setGemmaLoading(true);
			setGemmaError(null);
			gemmaInitPromiseRef.current = (async () => {
				try {
					const { FilesetResolver, LlmInference } = await import("@mediapipe/tasks-genai");
					const fileset = await FilesetResolver.forGenAiTasks(
						"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.25/wasm"
					);

					const instance = await LlmInference.createFromOptions(fileset, {
						baseOptions: {
							// Use the public folder (served as static assets by Next.js)
							modelAssetPath: "/models/gemma3-1b-it-int4-web.task",
						},
						maxTokens: GEMMA_MAX_TOKENS,
						topK: 40,
						temperature: 0.8,
					});
					gemmaInstanceRef.current = instance;
					setGemmaReady(true);
				} catch (error) {
					setGemmaError(error instanceof Error ? error.message : "Failed to load Gemma model");
					throw error;
				} finally {
					setGemmaLoading(false);
					gemmaInitPromiseRef.current = null;
				}
			})();
		}

		try {
			await gemmaInitPromiseRef.current;
		} catch (error) {
			throw error;
		}

		return gemmaInstanceRef.current;
	}, [gemmaInstanceRef, gemmaInitPromiseRef]);

	// Fix hydration: only render portal after mount
	useEffect(() => {
		setMounted(true);
		// Load user session and subscription from localStorage (simulated authentication)
		if (typeof window !== "undefined") {
			try {
				const storedIsLoggedIn = localStorage.getItem("user_logged_in") === "true";
				const storedSubscription = localStorage.getItem("user_subscription") as
					| "none"
					| "basic"
					| "plus"
					| "pro"
					| "max"
					| "ultimate"
					| null;
				setIsLoggedIn(storedIsLoggedIn);
				setUserSubscription(storedSubscription || "none");

				// Auto-select model based on subscription
				if (storedSubscription === "ultimate") {
					setSelectedModel("ode");
				} else if (storedSubscription === "max") {
					setSelectedModel("villanelle");
				} else {
					setSelectedModel("tanka");
				}
			} catch {
				// ignore errors
			}
			// Load chat history only if logged in
			if (localStorage.getItem("user_logged_in") === "true") {
				setChatHistory(loadChatHistory());
			}
		}
	}, []);

	useEffect(() => {
		if (selectedModel === "villanelle" || selectedModel === "ode") {
			void initializeGemma().catch(() => undefined);
		}
	}, [selectedModel, initializeGemma]);

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

	useEffect(() => {
		return () => {
			if (gemmaInstanceRef.current?.close) {
				gemmaInstanceRef.current.close();
			}
			gemmaInstanceRef.current = null;
		};
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

	const toggleNote = useCallback((note: string) => {
		setSelected((s) => (s.includes(note) ? s.filter((x) => x !== note) : [...s, note]));
	}, []);

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
		const chat: ChatHistory = {
			id: currentChatId || `chat-${Date.now()}`,
			timestamp: Date.now(),
			messages: chatMessages,
			preview,
		};
		const updated = [chat, ...chatHistory.filter((c) => c.id !== chat.id)];
		setChatHistory(updated);
		saveChatHistory(updated);
		setCurrentChatId(chat.id);
	}, [isLoggedIn, chatMessages, currentChatId, chatHistory]);

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
		[chatHistory]
	);

	// Delete a chat from history
	const deleteChat = useCallback(
		(chatId: string) => {
			const updated = chatHistory.filter((c) => c.id !== chatId);
			setChatHistory(updated);
			saveChatHistory(updated);
		},
		[chatHistory]
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
					"coffee"
				);
			}
			setPopupOpen(false);
			setSelectedProduct(null);
		},
		[selectedProduct, addItem, notify]
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
							["chocolate", "caramel", "sweet", "honey"].some((kw) => n.toLowerCase().includes(kw))
						)
					)
					.slice(0, 4);
				response = "For sweet, chocolatey flavors, Kafelot suggests these:";
				recommendedProducts = sweet;
			} else if (input.includes("fruity") || input.includes("citrus") || input.includes("floral")) {
				const fruity = allProducts
					.filter((p) =>
						p.notes?.some((n) => ["citrus", "floral", "fruity", "berry"].some((kw) => n.toLowerCase().includes(kw)))
					)
					.slice(0, 4);
				response = "For bright, fruity notes, Kafelot recommends these great choices:";
				recommendedProducts = fruity;
			} else {
				const tokens = input.split(/\s+/).filter((w) => w.length > 3);
				const matches = allProducts
					.filter((p) =>
						tokens.some((t) => p.name.toLowerCase().includes(t) || p.description?.toLowerCase().includes(t))
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
		[visualizationMode, notify]
	);

	// Smart AI-like chat handler
	const handleChatSubmit = useCallback(async () => {
		const prompt = chatInput.trim();
		if (!prompt) return;
		const userMsg: Message = { role: "user", content: prompt };
		setChatMessages((m) => [...m, userMsg]);
		setChatInput("");
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
						/(?:show|display|find|search)\s+(?:me\s+)?(?:the\s+)?(?:molecule\s+)?(.+?)(?:\s+molecule|\s+structure)?$/i
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
		// Tanka will handle chemistry questions naturally through the Python endpoint

		const useGemma = selectedModel === "villanelle" || selectedModel === "ode";

		if (useGemma) {
			try {
				const llm = await initializeGemma();
				if (!llm) {
					throw new Error("Gemma model is not ready");
				}
				let aggregated = "";
				setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);
				await llm.generateResponse(prompt, (partial: string, done: boolean) => {
					aggregated += partial;
					setChatMessages((prev) => {
						const updated = [...prev];
						const lastIndex = updated.length - 1;
						if (lastIndex >= 0 && updated[lastIndex]?.role === "assistant") {
							updated[lastIndex] = { ...updated[lastIndex], content: aggregated };
						}
						return updated;
					});
					if (done) {
						setIsTyping(false);
					}
				});
				setChatMessages((prev) => {
					const updated = [...prev];
					const lastIndex = updated.length - 1;
					if (lastIndex >= 0 && updated[lastIndex]?.role === "assistant") {
						updated[lastIndex] = {
							...updated[lastIndex],
							content: updated[lastIndex].content.trim(),
						};
					}
					return updated;
				});
				setIsTyping(false);
			} catch (error) {
				console.error("Gemma inference error:", error);
				setGemmaError(error instanceof Error ? error.message : "Gemma model unavailable");
				setChatMessages((prev) => {
					if (prev.length === 0) return prev;
					const updated = [...prev];
					const lastIndex = updated.length - 1;
					if (lastIndex >= 0 && updated[lastIndex]?.role === "assistant" && updated[lastIndex].content === "") {
						updated.pop();
					}
					return updated;
				});
				if (gemmaInstanceRef.current?.close) {
					gemmaInstanceRef.current.close();
				}
				gemmaInstanceRef.current = null;
				setGemmaReady(false);
				// No Python fallback for Gemma-only models; use local heuristic
				const fallbackResponse = generateFallbackResponse(lowerPrompt, chatMode);
				const assistantMsg: Message = {
					role: "assistant",
					content: fallbackResponse.response,
					products: fallbackResponse.products,
				};
				setChatMessages((m) => [...m, assistantMsg]);
				setIsTyping(false);
			}
			return;
		}

		try {
			// If chemistry mode with Tanka enabled, use Python chat
			const shouldUsePython = smarterAIAvailable && (chemistryMode ? useTankaModel : true);
			const endpoint = shouldUsePython ? "/api/python-chat" : "/api/chat";
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: [...chatMessages, userMsg],
					mode: chatMode,
					model: selectedModel,
					subscription: userSubscription,
					chemistry_mode: chemistryMode && useTankaModel,
					context: { products: allProducts },
				}),
			});

			if (!response.ok) throw new Error("Failed to get response");

			const data = await response.json();
			const assistantMsg: Message = {
				role: "assistant",
				content: data.response,
				products: data.products || [],
			};

			setChatMessages((m) => [...m, assistantMsg]);
		} catch (error) {
			console.error("Chat error:", error);
			const fallbackResponse = generateFallbackResponse(lowerPrompt, chatMode);
			const assistantMsg: Message = {
				role: "assistant",
				content: fallbackResponse.response,
				products: fallbackResponse.products,
			};
			setChatMessages((m) => [...m, assistantMsg]);
		} finally {
			setIsTyping(false);
		}
	}, [
		chatInput,
		chatMessages,
		chatMode,
		selectedModel,
		userSubscription,
		generateFallbackResponse,
		smarterAIAvailable,
		initializeGemma,
		chemistryMode,
		visualizationMode,
		fetchMoleculeData,
	]);

	const handleChatKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleChatSubmit();
			}
		},
		[handleChatSubmit]
	);

	const dock = (
		<div className={`recommender-window ${open ? "open" : "closed"}`} role="dialog" aria-hidden={!open}>
			<div className="recommender-header">
				<div className="recommender-header-meta">
					<strong>Kafelot</strong>
					<div
						className="smarter-ai-badge"
						data-status={smarterAIAvailable ? "online" : "offline"}
						title="Smarter AI (Python service) status"
						aria-live="polite"
					>
						<span className="badge-icon">AI</span>
						<span className="badge-text">
							<span className="badge-label">Smarter AI</span>
							<span className="badge-status">{smarterAIAvailable ? "Online" : "Offline"}</span>
						</span>
					</div>
				</div>
				<div className="recommender-actions">
					<button className="recommender-close" aria-label="Close" onClick={() => setOpen(false)}>
						×
					</button>
				</div>
			</div>
			<div className="recommender-body">
				{step === "greeting" && (
					<div className="recommender-greeting">
						<p>
							👋 Hello! I&apos;m Kafelot, your coffee pilot explorer. I can recommend capsules based on your
							preferences, answer questions about coffee, and help you discover new flavors.
						</p>
						{!isLoggedIn && (
							<div className="login-notice">
								<p style={{ fontSize: "0.9rem", color: "rgba(250, 204, 144, 0.7)", margin: "0.5rem 0" }}>
									💡 <strong>Tip:</strong> Log in to unlock chat history and access Kafelot Villanelle and
									Kafelot Ode models with your subscription!
								</p>
							</div>
						)}
						<div className="recommender-cta">
							<button onClick={() => setStep("chat")}>💬 Chat with me</button>
							<button onClick={() => setStep("prefs")}>🔍 Advanced search</button>
							<button
								onClick={() => {
									setStep("results");
									setResults(allProducts.slice(0, 8));
								}}
							>
								⭐ Show popular
							</button>
							{isLoggedIn && chatHistory.length > 0 && (
								<button onClick={() => setStep("history")}>📜 Chat history</button>
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
											localStorage.setItem("user_logged_in", "true");
											localStorage.setItem("user_subscription", "max");
											setIsLoggedIn(true);
											setUserSubscription("max");
											setSelectedModel("villanelle");
											setChatHistory(loadChatHistory());
										}}
										style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
									>
										Login as Max
									</button>
									<button
										onClick={() => {
											localStorage.setItem("user_logged_in", "true");
											localStorage.setItem("user_subscription", "ultimate");
											setIsLoggedIn(true);
											setUserSubscription("ultimate");
											setSelectedModel("ode");
											setChatHistory(loadChatHistory());
										}}
										style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
									>
										Login as Ultimate
									</button>
									<button
										onClick={() => {
											localStorage.setItem("user_logged_in", "true");
											localStorage.setItem("user_subscription", "basic");
											setIsLoggedIn(true);
											setUserSubscription("basic");
											setSelectedModel("tanka");
											setChatHistory(loadChatHistory());
										}}
										style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
									>
										Login as Basic
									</button>
								</div>
							) : (
								<button
									onClick={() => {
										localStorage.removeItem("user_logged_in");
										localStorage.removeItem("user_subscription");
										setIsLoggedIn(false);
										setUserSubscription("none");
										setSelectedModel("tanka");
										setChatHistory([]);
										setChatMessages([]);
									}}
									style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", margin: "0 auto", display: "block" }}
								>
									Logout
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
													`${percentage}%`
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
								{results.map((r) => (
									<div key={r.id} className="result-item">
										<Image src={r.image} alt={r.name} width={70} height={48} />
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
											<div className="result-actions">
												<button className="btn-ghost" onClick={() => handleAdd(r)}>
													Add to bag
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
								))}
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
								☕ Coffee Helper
							</button>
							<button
								className={chatMode === "general" ? "active" : ""}
								onClick={() => {
									setChatMode("general");
									setChemistryMode(false);
								}}
								title="Specialized AI Mode - Chat about anything, JS fallback available"
							>
								🤖 Specialized AI
							</button>
							<button
								className={chemistryMode ? "active chemistry-mode" : "chemistry-mode"}
								onClick={() => {
									// Only allow toggle if Tanka + Ultimate
									if (selectedModel === "tanka" && isLoggedIn && userSubscription === "ultimate") {
										setChatMode("general");
										setChemistryMode(!chemistryMode);
										// Automatically switch to Tanka when enabling chemistry mode
										if (!chemistryMode) {
											setSelectedModel("tanka");
										}
									}
								}}
								disabled={selectedModel !== "tanka" || !isLoggedIn || userSubscription !== "ultimate"}
								title={
									!isLoggedIn
										? "Chemistry Mode - Login required"
										: userSubscription !== "ultimate"
										? "Chemistry Mode - Ultimate subscription required 🔒"
										: selectedModel !== "tanka"
										? "Chemistry Mode - Switch to Tanka model first 🔒"
										: "Chemistry Mode - Molecule visualization (Tanka + Ultimate)"
								}
							>
								🧪 Chemistry Mode{" "}
								{(selectedModel !== "tanka" || !isLoggedIn || userSubscription !== "ultimate") && "🔒"}
							</button>
						</div>

						{chatMode === "general" && (
							<>
								<div className="subscription-info-box">
									{!isLoggedIn ? (
										<div className="subscription-notice">
											<p style={{ margin: 0, fontSize: "0.95rem", color: "rgba(250, 204, 144, 0.8)" }}>
												🔓 <strong>Not logged in</strong> - Using Tanka (free)
											</p>
											<p
												style={{
													margin: "0.25rem 0 0 0",
													fontSize: "0.85rem",
													color: "rgba(250, 204, 144, 0.6)",
												}}
											>
												Log in to access Villanelle and Ode models
											</p>
										</div>
									) : (
										<div className="subscription-status">
											<p style={{ margin: 0, fontSize: "0.95rem", color: "rgba(250, 204, 144, 0.8)" }}>
												🎫 <strong>Subscription:</strong>{" "}
												{userSubscription === "none"
													? "None (Tanka only)"
													: userSubscription.charAt(0).toUpperCase() + userSubscription.slice(1)}
											</p>
											{userSubscription === "none" ||
											userSubscription === "basic" ||
											userSubscription === "pro" ? (
												<p
													style={{
														margin: "0.25rem 0 0 0",
														fontSize: "0.85rem",
														color: "rgba(250, 204, 144, 0.6)",
													}}
												>
													Upgrade to Max for Villanelle or Ultimate for Ode
												</p>
											) : null}
										</div>
									)}
								</div>

								<div className="model-selector">
									<label>🧠 AI Model:</label>
									<button
										className={selectedModel === "tanka" ? "active" : ""}
										onClick={() => setSelectedModel("tanka")}
										title="Tanka - 🌿 Lightweight & Fast (~30M params) - Coffee-focused recommendations, quick responses, perfect for quick searches"
									>
										🌿 Tanka
									</button>
									<button
										className={selectedModel === "villanelle" ? "active" : ""}
										onClick={() => setSelectedModel("villanelle")}
										title={
											chemistryMode
												? "Villanelle - Not available in Chemistry Mode (Tanka only)"
												: isLoggedIn && (userSubscription === "max" || userSubscription === "ultimate")
												? "Villanelle - ⚡ Balanced & Smart (~60M params) - Deep flavor analysis, personalized insights, nuanced recommendations"
												: "Villanelle - Requires Max or Ultimate subscription (locked)"
										}
										disabled={
											chemistryMode ||
											!isLoggedIn ||
											(userSubscription !== "max" && userSubscription !== "ultimate")
										}
									>
										⚡ Villanelle{" "}
										{(chemistryMode ||
											!isLoggedIn ||
											(userSubscription !== "max" && userSubscription !== "ultimate")) &&
											"🔒"}
									</button>
									<button
										className={selectedModel === "ode" ? "active" : ""}
										onClick={() => setSelectedModel("ode")}
										title={
											chemistryMode
												? "Ode - Not available in Chemistry Mode (Tanka only)"
												: isLoggedIn && userSubscription === "ultimate"
												? "Ode - 🎼 Expert & Deep (~90M params) - Advanced flavor profiling, comprehensive analysis, literary flair"
												: "Ode - Requires Ultimate subscription (locked)"
										}
										disabled={chemistryMode || !isLoggedIn || userSubscription !== "ultimate"}
									>
										🎼 Ode {(chemistryMode || !isLoggedIn || userSubscription !== "ultimate") && "🔒"}
									</button>
								</div>

								{chemistryMode && (
									<div className="visualization-mode-selector" style={{ marginTop: "1rem" }}>
										<label>🔬 Molecule Display:</label>
										<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
											<button
												className={visualizationMode === "text" ? "active" : ""}
												onClick={() => setVisualizationMode("text")}
												title="Text only - Show molecular properties without visualization"
											>
												📝 Text Only
											</button>
											<button
												className={visualizationMode === "2d" ? "active" : ""}
												onClick={() => setVisualizationMode("2d")}
												title="2D Structure - SVG molecular diagram"
											>
												🖼️ 2D Structure
											</button>
											<button
												className={visualizationMode === "3d" ? "active" : ""}
												onClick={() => setVisualizationMode("3d")}
												title="3D Model - SDF format for PyMOL"
											>
												🧊 3D Model
											</button>
											<button
												className={visualizationMode === "both" ? "active" : ""}
												onClick={() => setVisualizationMode("both")}
												title="Both 2D & 3D - Show all visualizations"
											>
												🔄 Both
											</button>
										</div>
									</div>
								)}

								{chemistryMode && (
									<div className="tanka-model-toggle-section" style={{ marginTop: "1rem" }}>
										<label style={{ display: "block", marginBottom: "0.5rem" }}>🤖 Tanka AI Model:</label>
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
												? "🤖 Tanka Model ON (Chemistry Chat)"
												: "🔬 Visualization Only (No AI Chat)"}
											{(!isLoggedIn || userSubscription !== "ultimate") && " 🔒"}
										</button>
										{!useTankaModel && (
											<p
												style={{
													fontSize: "0.85rem",
													color: "rgba(250, 204, 144, 0.7)",
													marginTop: "0.5rem",
												}}
											>
												💡 Uses RDKit, Py3Dmol, and Pillow for molecule visualization
											</p>
										)}
									</div>
								)}

								{(selectedModel === "villanelle" || selectedModel === "ode") && (
									<p
										className="gemma-status"
										style={{
											marginTop: "0.75rem",
											fontSize: "0.85rem",
											color: "rgba(250, 204, 144, 0.7)",
										}}
										aria-live="polite"
									>
										{gemmaLoading
											? "Loading Gemma on-device model..."
											: gemmaError
											? `Gemma unavailable (${gemmaError}).`
											: gemmaReady
											? "Gemma on-device model is ready."
											: "Preparing Gemma on-device model..."}
									</p>
								)}

								{/* Model descriptions below buttons */}
								<div className="model-description">
									{selectedModel === "tanka" && (
										<div className="description-content">
											<strong>🌿 Kafelot Tanka</strong>
											<p>
												Lightweight &amp; Fast. Perfect for quick coffee searches. Focuses on Nespresso
												capsule recommendations with instant responses.
											</p>
										</div>
									)}
									{selectedModel === "villanelle" && (
										<div className="description-content">
											<strong>⚡ Kafelot Villanelle</strong>
											<p>
												Balanced &amp; Smart. Provides deeper flavor analysis and personalized insights
												based on your preferences. Great for discovering new favorites.
											</p>
										</div>
									)}
									{selectedModel === "ode" && (
										<div className="description-content">
											<strong>🎼 Kafelot Ode</strong>
											<p>
												Expert &amp; Deep. Advanced flavor profiling with comprehensive analysis. Crafts
												poetic and detailed recommendations for the true coffee connoisseur.
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
											<p>
												☕ <strong>Coffee Helper Mode</strong>
											</p>
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
											<p>
												🧪 <strong>Chemistry Mode</strong>{" "}
												<span style={{ color: "rgba(250, 204, 144, 0.6)" }}>(Tanka + Ultimate)</span>
											</p>
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
											<p>
												🤖 <strong>Specialized AI Mode</strong>
											</p>
											<p>
												I can chat about coffee topics, brewing techniques, origins, and more. Try asking:
											</p>
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
									<div className="chat-bubble">
										{msg.content.split("\n").map((line, i) => (
											<React.Fragment key={i}>
												{line}
												{i < msg.content.split("\n").length - 1 && <br />}
											</React.Fragment>
										))}
									</div>
									{msg.products && msg.products.length > 0 && (
										<div className="chat-products">
											{msg.products.map((p) => (
												<div key={p.id} className="chat-product-card">
													<Image src={p.image} alt={p.name} width={50} height={35} />
													<div className="chat-product-info">
														<strong>{p.name}</strong>
														<span className="chat-product-intensity">
															Intensity: {p.intensity ?? "N/A"}
														</span>
													</div>
													<button className="chat-add-btn" onClick={() => handleAdd(p)}>
														+
													</button>
												</div>
											))}
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
										<h3>🧪 {currentMolecule.name || currentMolecule.chembl_id}</h3>
										<button
											className="close-molecule"
											onClick={() => setCurrentMolecule(null)}
											title="Close molecule view"
										>
											✕
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
													<p>
														📥 <strong>SDF Data Available</strong> - Use PyMOL or similar tools to
														visualize
													</p>
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
													>
														⬇️ Download SDF
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
							<textarea
								value={chatInput}
								onChange={(e) => setChatInput(e.target.value)}
								onKeyDown={handleChatKeyDown}
								placeholder={
									chatMode === "coffee"
										? "Ask about coffee capsules, flavors, or brewing..."
										: "Ask me anything - coffee, tech, science, or just chat..."
								}
								rows={2}
							/>
							<button onClick={handleChatSubmit} disabled={!chatInput.trim() || isTyping}>
								{isTyping ? "..." : "Send"}
							</button>
						</div>
						<div className="recommender-cta">
							<button onClick={startNewChat}>🆕 New Chat</button>
							<button
								onClick={() => {
									saveCurrentChat();
									setStep("history");
								}}
							>
								📜 History
							</button>
							<button onClick={() => setStep("greeting")}>Back</button>
						</div>
					</div>
				)}

				{step === "history" && (
					<div className="recommender-history">
						<h3 style={{ margin: "0 0 12px 0", fontSize: "16px" }}>Chat History 📜</h3>
						{!isLoggedIn ? (
							<div style={{ textAlign: "center", padding: "2rem 1rem" }}>
								<p style={{ color: "rgba(250, 204, 144, 0.8)", fontSize: "1.1rem", margin: "0 0 0.5rem 0" }}>
									🔒 Chat history is locked
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
											🗑️
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
				<Image src="/Kafelot.svg" alt="Kafelot" width={24} height={24} priority />
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
