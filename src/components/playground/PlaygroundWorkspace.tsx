"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { PLAYGROUND_MODEL_KEYS, VISION_MODEL_450M, AUDIO_MODEL_1_5B, CONTEXT_LEVELS, MODEL_LABEL_BY_KEY, formatContextTokens, isPlaygroundModelKey, isVisionModelKey, isAudioModelKey, tierCanUseThinkingModel, type UserSubscriptionTier } from "@/lib/modelAccess";
import { buildPageHref } from "@/lib/pages";
import { getOrCreateFingerprint } from "@/lib/fingerprint";
import { useModelPrewarm } from "@/hooks/useModelPrewarm";
import { useModelLoadStatus } from "@/hooks/useModelLoadStatus";
import { AiBalanceExhausted, readBalanceGate, type BalanceGate } from "@/components/ai/AiBalanceExhausted";
import PlaygroundModelLineup, { type SpectreAccessState } from "./PlaygroundModelLineup";
import PlaygroundSettings, { DEFAULT_PREFERENCES, type PlaygroundPreferences } from "./PlaygroundSettings";
import PlaygroundMessageContent from "./PlaygroundMessageContent";
import DesktopAppDownload from "./DesktopAppDownload";
import WorkspaceIcon from "./WorkspaceIcon";
import { AttachmentMenu, GithubProjectDialog, SourceList, usePlaygroundSources, type SourceContext } from "./PlaygroundSources";
import { COMPACTION_OPTIONS, compactionMode, type ContextState } from "@/lib/playgroundContext";
import { deleteServerSession, getServerSession, listServerSessions, preferencesForServerSession, saveServerSession, type SavedSession, type SavedMessage, type SavedToolActivity } from "@/lib/playgroundSessions";
import PlaygroundRuntime from "./PlaygroundRuntime";
import PlaygroundRunHistory from "./PlaygroundRunHistory";
import PlaygroundAgentReview from "./PlaygroundAgentReview";
import { AgentInteractions } from "./PlaygroundAgentWorkspace";
import { HostedAgentWorkspace, agentResultText } from "@/lib/playgroundHostedAgent";
import { conversationContext } from "@/lib/playgroundConversationContext";
import { displayToolText } from "@/lib/playgroundToolText";
import { explicitlyRequestsWebSearch } from "@/lib/playgroundToolIntent";
import { readAccountSession } from "@/lib/accountSession";
import WorkspacePicker from "./WorkspacePicker";
import PlaygroundHelp from "./PlaygroundHelp";
import { downloadDocument, createDocument, type DocumentFrame } from "@/lib/playgroundDocuments";

type WebSource = { title: string; url: string; snippet: string };
type Message = SavedMessage;
type Conversation = { id: string; title: string; messages: Message[] };
type StreamEvent = { delta?: string; reasoning?: string; notice?: string; error?: string; done?: boolean; context?: ContextState; usage?: { completion_tokens?: number; prompt_tokens?: number }; sources?: WebSource[]; document?: DocumentFrame };
const PREFERENCES_KEY = "filspresso_playground_preferences_v2";
const titleFor = (messages: Message[]) => messages.find((message) => message.role === "user")?.content.slice(0, 54) || "New conversation";
/** "294 t/s" — output divided by measured wall time, computed for display only. */
const formatTokensPerSecond = (tokens?: number, seconds?: number) => {
	if (tokens === undefined || !tokens || !seconds || seconds <= 0) return null;
	const tps = tokens / seconds;
	return `${tps >= 10 ? Math.round(tps) : tps.toFixed(1)} t/s`;
};
const formatDocumentBytes = (bytes: number) => {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${bytes} B`;
};
const messageWithSources = (message: Message) => message.content + (message.sources || []).map((source) => `\n\n<attached-source name=${JSON.stringify(source.name)}>\n${source.text}\n</attached-source>`).join("");

export default function PlaygroundWorkspace({ tier, access }: { tier: UserSubscriptionTier; access: SpectreAccessState }) {
	const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
	const [view, setView] = useState<"chat" | "settings" | "prices" | "activity" | "review">("chat");
	const [helpOpen, setHelpOpen] = useState(false);
	const [railExpanded, setRailExpanded] = useState(false);
	const [mode, setMode] = useState<"chat" | "plan" | "build">("chat");
	const [agent] = useState(() => new HostedAgentWorkspace());
	const agentState = useSyncExternalStore(agent.subscribe, agent.getSnapshot, agent.getSnapshot);
	const agentBusy = ["checking", "creating", "inspecting", "running", "awaiting_approval", "awaiting_question", "stopping"].includes(agentState.phase);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [conversationId, setConversationId] = useState("initial");
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [editingFrom, setEditingFrom] = useState<number | null>(null);
	const [streaming, setStreaming] = useState(false);
	const [balanceGate, setBalanceGate] = useState<BalanceGate | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const [githubOpen, setGithubOpen] = useState(false);
	const [notice, setNotice] = useState("");
	const [contextState, setContextState] = useState<ContextState | null>(null);
	const [compactNext, setCompactNext] = useState(false);
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [serverSessions, setServerSessions] = useState<SavedSession[]>([]);
	const checkpoints = useRef(new Map<string, { ids: string[]; history: NonNullable<ContextState["history"]>; state: ContextState }>());
	// Local conversation id -> server session uuid. In-memory only: a reload starts local
	// conversations anew, and the server's own list is the only durable resume surface.
	const sessionIds = useRef(new Map<string, string>());
	const saveQueues = useRef(new Map<string, Promise<void>>());
	const legacySessions = useRef(new Set<string>());
	const legacyContexts = useRef(new Map<string, ContextState>());
	const accountRevision = useRef(0);
	const shellRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const composerRef = useRef<HTMLDivElement>(null);
	const followRef = useRef(true);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const abortRef = useRef<AbortController | null>(null);
	const agentStartingRef = useRef(false);
	const resumeRef = useRef<AbortController | null>(null);
	const githubRef = useRef<HTMLButtonElement>(null);
	const attachments = usePlaygroundSources();
	const thinkingAllowed = tierCanUseThinkingModel(tier);
	const model = preferences.model;
	useEffect(() => () => { void agent.stop(true); }, [agent, conversationId, model, preferences.inputContextTokens, preferences.compactionMode]);
	useEffect(() => {
		const identity = () => { const account = readAccountSession(); return account?.email || account?.username || null; };
		let account = identity();
		const changed = () => { const next = identity(); if (next !== account || !next) { accountRevision.current++; sessionIds.current.clear(); checkpoints.current.clear(); legacySessions.current.clear(); legacyContexts.current.clear(); setConversations([]); setServerSessions([]); void agent.stop(true); abortRef.current?.abort(); setMessages([]); setInput(""); } account = next; };
		window.addEventListener("session-update", changed); window.addEventListener("storage", changed);
		return () => { window.removeEventListener("session-update", changed); window.removeEventListener("storage", changed); };
	}, [agent]);
	// Serialize snapshots per conversation, so a slow create or older PATCH cannot
	// overwrite a later turn. Failed saves remain visible instead of promising persistence.
	useEffect(() => {
		if (streaming || agentBusy || (!messages.length && (!sessionIds.current.has(conversationId) || legacySessions.current.has(conversationId)))) return;
		const id = conversationId; const revision = accountRevision.current; const snapshot = messages;
		const previous = saveQueues.current.get(id) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(async () => {
			if (revision !== accountRevision.current) return;
			const legacyCheckpoint = legacyContexts.current.get(id);
			const uuid = await saveServerSession({ uuid: sessionIds.current.get(id), title: titleFor(snapshot), model,
				inputContextTokens: preferences.inputContextTokens, compactionMode: preferences.compactionMode,
				activeContext: legacyCheckpoint ?? null, transcript: snapshot });
			if (revision !== accountRevision.current) return;
			if (uuid) sessionIds.current.set(id, uuid);
			else setNotice("This conversation could not be saved. It is still visible here; export it before leaving or retry after checking your connection. Saved transcripts are limited to 200 messages and 700 KB.");
		});
		saveQueues.current.set(id, next);
		void next.finally(() => { if (saveQueues.current.get(id) === next) saveQueues.current.delete(id); });
	}, [messages, conversationId, streaming, agentBusy, model, preferences.inputContextTokens, preferences.compactionMode]);
	const recommendations = [
		attachments.sources.some((source) => source.kind === "video" && source.status !== "error") && !isVisionModelKey(model) ? { key: VISION_MODEL_450M, description: "A Vision-Language (VL) model is recommended for video." } as const : null,
		attachments.sources.some((source) => source.kind === "audio" && source.status !== "error") && !isAudioModelKey(model) ? { key: AUDIO_MODEL_1_5B, description: "An Audio model is recommended for this audio file." } as const : null,
	].filter((item) => item !== null);
	useModelPrewarm({ modelKey: model, enabled: true });
	const modelLoad = useModelLoadStatus(model, "playground");
	const { waitUntilLoaded } = modelLoad;

	useEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			try {
				const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || localStorage.getItem("filspresso_playground_preferences_v1") || "null") as (Partial<PlaygroundPreferences> & { maxTokens?: number }) | null;
				if (!saved) return;
				setPreferences({
					model: typeof saved.model === "string" && isPlaygroundModelKey(saved.model) ? saved.model : DEFAULT_PREFERENCES.model,
					inputContextTokens: (CONTEXT_LEVELS as readonly number[]).includes(Number(saved.inputContextTokens ?? saved.maxTokens)) ? Number(saved.inputContextTokens ?? saved.maxTokens) : DEFAULT_PREFERENCES.inputContextTokens,
					compactionMode: compactionMode(saved.compactionMode),
					thinking: thinkingAllowed && saved.thinking === true,
					textSize: saved.textSize === "small" || saved.textSize === "large" ? saved.textSize : "standard",
					enterToSend: saved.enterToSend !== false,
				});
			} catch { /* A missing or invalid preference file uses the defaults. */ }
		});
		return () => window.cancelAnimationFrame(frame);
	}, [thinkingAllowed]);

	// The site navbar is fixed. Size the workspace to the space below its actual height.
	useEffect(() => {
		const navbar = document.querySelector(".header_body");
		if (!navbar) return;
		const measure = () => shellRef.current?.style.setProperty("--pgw-nav-height", `${Math.max(0, Math.ceil(navbar.getBoundingClientRect().bottom)) + 12}px`);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(navbar);
		return () => observer.disconnect();
	}, []);
	useEffect(() => () => { abortRef.current?.abort(); resumeRef.current?.abort(); }, []);
	// Server-saved conversations load when the sidebar opens, and only then: no extra
	// request on page view, and the list is always the account's current one.
	useEffect(() => {
		if (!sidebarOpen) return;
		let cancelled = false;
		void listServerSessions().then((sessions) => { if (!cancelled) setServerSessions(sessions); });
		return () => { cancelled = true; };
	}, [sidebarOpen]);
	useEffect(() => {
		const track = () => {
			const bottom = composerRef.current?.getBoundingClientRect().bottom ?? 0;
			followRef.current = bottom <= window.innerHeight + 180;
		};
		window.addEventListener("scroll", track, { passive: true });
		return () => window.removeEventListener("scroll", track);
	}, []);
	useEffect(() => {
		if (!messages.length || !followRef.current) return;
		const frame = requestAnimationFrame(() => composerRef.current?.scrollIntoView({ block: "end", behavior: "instant" }));
		return () => cancelAnimationFrame(frame);
	}, [messages]);
	useEffect(() => {
		const node = inputRef.current;
		if (!node) return;
		node.style.height = "auto";
		node.style.height = `${Math.min(220, Math.max(65, node.scrollHeight))}px`;
	}, [input, view]);
	useEffect(() => {
		const escape = (event: KeyboardEvent) => {
			if (event.key === "Escape") { setGithubOpen(false); setSidebarOpen(false); }
		};
		document.addEventListener("keydown", escape);
		return () => document.removeEventListener("keydown", escape);
	}, []);

	const savePreferences = (next: PlaygroundPreferences) => {
		if (streaming || agentBusy) return false;
		const safe = { ...next, thinking: thinkingAllowed && next.thinking };
		setPreferences(safe);
		try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(safe)); return true; } catch { return false; }
	};
	const rememberCurrent = () => {
		if (!messages.length) return;
		setConversations((previous) => [{ id: conversationId, title: titleFor(messages), messages }, ...previous.filter((chat) => chat.id !== conversationId)].slice(0, 30));
	};
	const newConversation = () => {
		if (abortRef.current || streaming || agentBusy) return;
		resumeRef.current?.abort();
		rememberCurrent();
		setConversationId(crypto.randomUUID());
		setMessages([]);
		setContextState(null); setCompactNext(false);
		setInput("");
		setEditingFrom(null);
		setBalanceGate(null);
		setView("chat");
		attachments.clear();
		setGithubOpen(false);
		setNotice("");
		window.requestAnimationFrame(() => inputRef.current?.focus());
	};
	const openConversation = (chat: Conversation) => {
		resumeRef.current?.abort();
		if (streaming || agentBusy || chat.id === conversationId) { setView("chat"); return; }
		rememberCurrent();
		setConversationId(chat.id);
		setMessages(chat.messages);
		setContextState(checkpoints.current.get(chat.id)?.state || null); setCompactNext(false);
		setView("chat");
		setInput("");
		setEditingFrom(null);
		setBalanceGate(null);
		setSidebarOpen(false);
		attachments.clear();
	};
	const forgetConversation = async (localId: string | null, knownUuid?: string) => {
		const revision = accountRevision.current;
		const ids = localId ? [localId] : [...sessionIds.current.entries()].filter(([, uuid]) => uuid === knownUuid).map(([id]) => id);
		setConversations(previous => previous.filter(item => !ids.includes(item.id)));
		if (localId === conversationId) { setMessages([]); setConversationId(crypto.randomUUID()); setContextState(null); }
		await Promise.all(ids.map(id => saveQueues.current.get(id) ?? Promise.resolve()));
		if (revision !== accountRevision.current) return;
		const uuid = knownUuid ?? (localId ? sessionIds.current.get(localId) : undefined);
		if (uuid && !await deleteServerSession(uuid)) { setNotice("The saved conversation could not be deleted. Please retry from the saved conversations list."); return; }
		for (const id of ids) { sessionIds.current.delete(id); checkpoints.current.delete(id); legacySessions.current.delete(id); legacyContexts.current.delete(id); }
		if (uuid) setServerSessions(previous => previous.filter(item => item.uuid !== uuid));
	};
	/**
	 * Resume a server-saved conversation: keep the context the server retained (the
	 * compaction checkpoint, the conversation's preferences), not the transcript -- which
	 * stays client-local by design. The checkpoint is registered without ids, so the next
	 * send continues exactly from the retained history, and the local conversation keeps
	 * its server session uuid so the next generation's run events link to it.
	 */
	const resumeServerSession = async (row: SavedSession) => {
		if (abortRef.current) return;
		resumeRef.current?.abort();
		const controller = new AbortController();
		resumeRef.current = controller;
		const saved = await getServerSession(row.uuid, controller.signal);
		if (controller.signal.aborted || resumeRef.current !== controller) return;
		resumeRef.current = null;
		if (!saved) { setNotice("This saved conversation could not be opened. Your current conversation is unchanged; please retry."); return; }
		rememberCurrent();
		savePreferences(preferencesForServerSession(saved, preferences));
		const nextId = crypto.randomUUID();
		sessionIds.current.set(nextId, saved.uuid);
		if (saved.activeContext) { legacySessions.current.add(nextId); legacyContexts.current.set(nextId, saved.activeContext); checkpoints.current.set(nextId, { ids: [], history: saved.activeContext.history || [], state: saved.activeContext }); }
		else if (!saved.transcript) legacySessions.current.add(nextId);
		setConversationId(nextId);
		setMessages(saved.transcript || []);
		setContextState(saved.activeContext ? { ...saved.activeContext, inputLimit: saved.activeContext.inputLimit || saved.inputContextTokens } : null);
		setCompactNext(false);
		setInput("");
		setEditingFrom(null);
		setBalanceGate(null);
		setSidebarOpen(false);
		setView("chat");
		attachments.clear();
		setNotice(saved.transcript ? "Conversation restored from your account." : `${saved.activeContext ? "This older session has only a compaction checkpoint; the original messages were not stored." : "This older session saved preferences only; the original messages were not stored."}${saved.sourceReferences.length ? " Source files must be attached again if needed." : ""}`);
		window.requestAnimationFrame(() => inputRef.current?.focus());
	};
	const exportConversation = () => {
		if (!messages.length) return;
		const blob = new Blob([JSON.stringify({ version: 1, title: titleFor(messages), messages }, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = "filspresso-conversation.json";
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	};
	const importConversation = async (file: File) => {
		if (streaming) return;
		resumeRef.current?.abort();
		if (file.size > 2 * 1024 * 1024) throw new Error("Please choose a JSON file smaller than 2 MB.");
		const data = JSON.parse(await file.text()) as { messages?: unknown };
		if (!Array.isArray(data.messages) || !data.messages.length || data.messages.length > 200) throw new Error("That file must contain between 1 and 200 messages.");
		const imported: Message[] = data.messages.map((raw: unknown) => {
			if (!raw || typeof raw !== "object") throw new Error("The file contains an invalid message.");
			const row = raw as Record<string, unknown>;
			if ((row.role !== "user" && row.role !== "assistant") || typeof row.content !== "string") throw new Error("The file contains an invalid message.");
			const sources = Array.isArray(row.sources) ? row.sources.filter((source): source is SourceContext => Boolean(source && typeof source === "object" && typeof source.name === "string" && typeof source.text === "string" && source.text.length <= 240_000)).slice(0, 8).map(({ name, kind, text }) => ({ name, kind: typeof kind === "string" ? kind : "document", text })) : undefined;
			return { id: crypto.randomUUID(), role: row.role, content: row.content, reasoning: typeof row.reasoning === "string" ? row.reasoning : undefined, model: typeof row.model === "string" && isPlaygroundModelKey(row.model) ? row.model : undefined, sources };
		});
		rememberCurrent();
		setConversationId(crypto.randomUUID());
		setMessages(imported);
		setContextState(null); setCompactNext(false);
		setInput("");
		setEditingFrom(null);
		setBalanceGate(null);
		setView("chat");
		attachments.clear();
	};

	const send = useCallback(async (promptOverride?: string, replaceFrom?: number) => {
		const replaceIndex = replaceFrom ?? editingFrom;
		const sources = promptOverride !== undefined || editingFrom !== null ? messages[replaceIndex ?? 0]?.sources || [] : attachments.contexts;
		const prompt = (promptOverride ?? input).trim() || (sources.length ? "Please analyze the attached sources." : "");
		if (!prompt || abortRef.current || (promptOverride === undefined && !attachments.ready)) return;
		resumeRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		followRef.current = true;
		const assistantId = crypto.randomUUID();
		setMessages((previous) => [...(replaceIndex !== null ? previous.slice(0, replaceIndex) : previous),
			{ id: crypto.randomUUID(), role: "user", content: prompt, sources },
			{ id: assistantId, role: "assistant", content: "", model },
		]);
		setInput("");
		setEditingFrom(null);
		setStreaming(true);
		setNotice("");
		setBalanceGate(null);
		const originalHistory = (replaceIndex !== null ? messages.slice(0, replaceIndex) : messages).filter(message => !message.failed);
		const checkpoint = checkpoints.current.get(conversationId);
		const validCheckpoint = checkpoint && checkpoint.ids.every((id, index) => originalHistory[index]?.id === id);
		const history = validCheckpoint ? [...checkpoint.history, ...originalHistory.slice(checkpoint.ids.length).map(message => ({ role: message.role, content: messageWithSources(message) }))]
			: originalHistory.map(message => ({ role: message.role, content: messageWithSources(message) }));
		attachments.clear();
		let accumulated = "";
		let reasoning = "";
		let generationStarted = 0;
		let outputTokens: number | undefined;
		let promptTokens: number | undefined;
		let webSources: WebSource[] | undefined;
		let documents: DocumentFrame[] | undefined;
		const update = (patch: Partial<Message>) => setMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, ...patch } : message));
		try {
			const loaded = await waitUntilLoaded(undefined, controller.signal);
			controller.signal.throwIfAborted();
			if (!loaded.ok) throw new Error(loaded.error || "The model could not be loaded. Please retry.");
			generationStarted = performance.now();
			const response = await fetch("/api/playground/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-kafelot-fingerprint": getOrCreateFingerprint(), "x-kafelot-scope": "general" },
				body: JSON.stringify({ message: prompt, model, input_context_tokens: preferences.inputContextTokens, compaction_mode: preferences.compactionMode, compact_now: compactNext, contexts: sources, history, thinking: thinkingAllowed && preferences.thinking, system_prompt: `The user's device reports the current date and time as ${new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(new Date())} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). This is based on the device clock, not web research.`, session_uuid: sessionIds.current.get(conversationId) }),
				signal: controller.signal,
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => null) as { message?: string } | null;
				if (response.status === 402) setBalanceGate(readBalanceGate(payload));
				throw new Error(payload?.message || `Request failed (${response.status}). Please retry.`);
			}
			if (!response.body) throw new Error("The runtime returned no response stream.");
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let pending = "";
			let noticeText = "";
			let completed = false;
			const consume = (line: string) => {
				if (!line.startsWith("data:")) return;
				const data = line.slice(5).trim();
				if (!data || data === "[DONE]") return;
				let event: StreamEvent;
				try { event = JSON.parse(data) as StreamEvent; } catch { return; }
				if (event.error) throw new Error(event.error);
				if (event.done === true) completed = true;
				if (event.context) {
					setContextState(event.context);
					if (event.context.compacted && event.context.history) {
						checkpoints.current.set(conversationId, { ids: originalHistory.map(message => message.id), history: event.context.history, state: event.context });
						setCompactNext(false);
					}
				}
				if (event.delta) accumulated += event.delta;
				if (event.reasoning) reasoning += event.reasoning;
				if (event.notice) { noticeText = event.notice; setNotice(event.notice); }
				if (typeof event.usage?.completion_tokens === "number") outputTokens = event.usage.completion_tokens;
				if (typeof event.usage?.prompt_tokens === "number") promptTokens = event.usage.prompt_tokens;
				if (Array.isArray(event.sources) && event.sources.length) { webSources = event.sources; update({ webSources }); }
				if (event.document?.id) { documents = [...(documents ?? []), event.document]; update({ documents }); }
			};
			for (;;) {
				const { done, value } = await reader.read();
				pending += decoder.decode(value, { stream: !done });
				const lines = pending.split("\n");
				pending = lines.pop() || "";
				for (const line of lines) consume(line);
				update({ content: accumulated, reasoning: reasoning || undefined });
				if (done) { consume(pending); break; }
			}
			if (!completed) throw new Error("The response ended before the model reported completion. The partial answer was kept; please retry if needed.");
			update({ content: accumulated || noticeText || "The model returned no answer.", reasoning: reasoning || undefined, failed: !accumulated, outputTokens, inputTokens: promptTokens, webSources: webSources ?? undefined, documents: documents ?? undefined, seconds: (performance.now() - generationStarted) / 1000 });
			if (noticeText) setNotice(noticeText);
		} catch (error) {
			const stopped = controller.signal.aborted;
			if (!stopped) setNotice(error instanceof Error ? error.message : "The request was interrupted. The partial answer was kept.");
			update({ content: stopped ? accumulated || "Generation stopped." : accumulated || (error instanceof Error ? error.message : "The request failed."), reasoning: reasoning || undefined, failed: !stopped, outputTokens, inputTokens: promptTokens, webSources: webSources ?? undefined, documents: documents ?? undefined, seconds: generationStarted ? (performance.now() - generationStarted) / 1000 : undefined });
		} finally {
			if (abortRef.current === controller) { abortRef.current = null; setStreaming(false); }
		}
	}, [input, editingFrom, messages, model, preferences.inputContextTokens, preferences.compactionMode, preferences.thinking, thinkingAllowed, waitUntilLoaded, attachments, conversationId, compactNext]);

	const sendAgent = async (runMode: "plan" | "build" = mode === "build" ? "build" : "plan") => {
		if (streaming || agentBusy || agentStartingRef.current) return;
		agentStartingRef.current = true;
		setStreaming(true);
		try {
			if (editingFrom !== null) throw new Error("Cancel the message edit before using agent tools.");
			const sources = attachments.contexts;
			const prompt = input.trim() || (sources.length ? "Please analyze the attached sources." : "");
			if (!prompt || !attachments.ready) return;
			const request = messageWithSources({ id: "", role: "user", content: prompt, sources });
			if (request.length > 8000) throw new Error("These sources exceed the agent message limit; nothing was silently removed.");
			if (!agent.getSnapshot().workspace) {
				setNotice("Preparing an isolated workspace…");
				await agent.check();
				if (!agent.getSnapshot().executionEnabled || !agent.getSnapshot().models.includes(model)) throw new Error(agent.getSnapshot().error || "Tools are unavailable for this model or deployment.");
				await agent.startSandbox();
			}
			if (!agent.getSnapshot().workspace) throw new Error(agent.getSnapshot().error || "The isolated workspace could not be started. Please retry.");
			const history = conversationContext(messages.map(message => ({ ...message, content: messageWithSources(message) })));
			if (!agent.continueFromTranscript(history)) throw new Error("This workspace needs cleanup before another request. Discard it and start fresh; previous approval is never reused.");
			const id = crypto.randomUUID(); const firstEvent = agent.getSnapshot().events.length;
			setMessages(previous => [...previous, { id: crypto.randomUUID(), role: "user", content: prompt, sources }, { id, role: "assistant", content: "", model }]);
			setInput(""); setNotice(""); setStreaming(true); attachments.clear();
			const update = () => {
				const snapshot = agent.getSnapshot(); const events = snapshot.events.slice(firstEvent);
				const content = events.flatMap(event => event.kind === "message" ? [event.text] : event.kind === "question.answered" ? [`Clarification answers (not execution consent): ${JSON.stringify(event.decision.answers)}`] : event.kind === "stopped" ? [`Agent stopped: ${event.message}`] : []).join("\n\n");
				const tools: SavedToolActivity[] = [];
				for (const event of events) {
					if (event.kind === "tool.proposed") tools.push({ id: event.call.id, name: event.call.name, arguments: event.call.arguments, status: "proposed" });
					if (event.kind === "tool.finished") { const tool = tools.find(item => item.id === event.invocation.call.id); if (tool) { tool.status = "finished"; tool.result = agentResultText(event.invocation); } }
				}
				const failure = snapshot.phase === "failed" && snapshot.error && !events.some(event => event.kind === "stopped") ? snapshot.error : "";
				setMessages(previous => previous.map(message => message.id === id ? { ...message, content: [content, failure].filter(Boolean).join("\n\n"), tools, failed: snapshot.phase === "failed" } : message));
			};
			const unsubscribe = agent.subscribe(update);
			try { await agent.run({ model, inputContextTokens: preferences.inputContextTokens, compactionMode: preferences.compactionMode, sessionUuid: sessionIds.current.get(conversationId) }, runMode, request); update(); setMessages(previous => previous.map(message => message.id === id && !message.content ? { ...message, content: "Agent stopped. No further action was approved or retried." } : message)); }
			finally { unsubscribe(); }
		} catch (failure) { setNotice(failure instanceof Error ? failure.message : "The agent request could not start."); }
		finally { agentStartingRef.current = false; setStreaming(false); }
	};
	const submit = () => mode === "chat" && !explicitlyRequestsWebSearch(input) ? void send() : void sendAgent(mode === "build" ? "build" : "plan");

	const [savingDocument, setSavingDocument] = useState<string | null>(null);
	// A user gesture saves a reply the model did not fence. Same backend, same account scoped
	// service as the streamed documents: one honest place to look for kept files.
	const saveReplyAsDocument = async (message: Message) => {
		const content = message.content.trim();
		if (!content || savingDocument) return;
		setSavingDocument(message.id);
		setNotice("");
		try {
			const heading = /^#{1,3}\s+(.{3,80})$/m.exec(content)?.[1]?.replace(/[*_`#]/g, "").trim();
			const created = await createDocument(heading || "Saved reply", content);
			if (!created) { setNotice("This reply could not be saved as a document. Please retry."); return; }
			setMessages(previous => previous.map(item => item.id === message.id
				? { ...item, documents: [...(item.documents || []), { id: created.id, name: created.name, bytes: created.contentBytes }] }
				: item));
			setNotice(`Saved “${created.name}” to your documents.`);
		} finally { setSavingDocument(null); }
	};

	const allConversations = messages.length ? [{ id: conversationId, title: titleFor(messages), messages }, ...conversations.filter((chat) => chat.id !== conversationId)] : conversations;
	const filteredConversations = allConversations.filter((chat) => `${chat.title} ${chat.messages.map((message) => message.content).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
	// The conversation in view is served by its own session row; resuming it into itself
	// would fork the context, so it is not offered twice.
	const visibleSessionIds = new Set(allConversations.map(chat => sessionIds.current.get(chat.id)).filter(Boolean));
	const serverConversations = serverSessions.filter((session) => !visibleSessionIds.has(session.uuid) && session.title.toLowerCase().includes(search.toLowerCase()));
	const empty = !messages.length;
	const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
	const measuredInputTokens = lastAssistant?.inputTokens ?? (contextState ? contextState.tokensAfter : undefined);
	const measuredInputLimit = contextState?.inputLimit || preferences.inputContextTokens;
	const contextPercent = measuredInputTokens !== undefined && measuredInputLimit > 0
		? Math.min(100, Math.max(0, Math.round((measuredInputTokens / measuredInputLimit) * 100)))
		: null;

	return (
		<div className="pgw" ref={shellRef} data-sidebar={sidebarOpen} data-rail-expanded={railExpanded} data-text-size={preferences.textSize}>
			<nav className="pgw-rail" aria-label="Playground navigation">
				<button type="button" className="pgw-icon-button" aria-label="Expand navigation labels" aria-expanded={railExpanded} title="Navigation labels" onClick={() => setRailExpanded(!railExpanded)}><WorkspaceIcon name="sidebar" /><span className="pgw-nav-label">Collapse labels</span></button>
				<button type="button" className="pgw-icon-button" aria-label="New conversation" title="New conversation" disabled={streaming} onClick={newConversation}><WorkspaceIcon name="new" /><span className="pgw-nav-label">New conversation</span></button>
				<button type="button" className="pgw-icon-button" aria-label="Search conversations" title="Conversations" aria-expanded={sidebarOpen} aria-controls="pgw-conversations" onClick={() => { setSidebarOpen(!sidebarOpen); window.requestAnimationFrame(() => searchRef.current?.focus()); }}><WorkspaceIcon name="search" /><span className="pgw-nav-label">Conversations</span></button>
				<button type="button" className="pgw-icon-button" aria-label="Recorded activity" title="Activity" aria-pressed={view === "activity"} onClick={() => setView(view === "activity" ? "chat" : "activity")}><WorkspaceIcon name="file" /><span className="pgw-nav-label">Activity</span></button>
				<button type="button" className="pgw-icon-button" aria-label="API Prices" title="API Prices" aria-pressed={view === "prices"} onClick={() => setView(view === "prices" ? "chat" : "prices")}><WorkspaceIcon name="prices" /><span className="pgw-nav-label">API Prices</span></button>
				<button type="button" className="pgw-icon-button" aria-label="Settings" title="Settings" aria-pressed={view === "settings"} onClick={() => setView(view === "settings" ? "chat" : "settings")}><WorkspaceIcon name="settings" /><span className="pgw-nav-label">Settings</span></button>
				<button type="button" className="pgw-icon-button" aria-label="Web Playground instructions" title="Instructions" aria-haspopup="dialog" onClick={() => setHelpOpen(true)}><WorkspaceIcon name="help" /><span className="pgw-nav-label">Instructions</span></button>
				<div className="pgw-rail-bottom">
					<Link className="pgw-account-chip" href={buildPageHref("account")} title={`${tier.toUpperCase()} plan · Account`}>{tier.slice(0, 1).toUpperCase()}</Link>
				</div>
			</nav>
			{sidebarOpen && <button type="button" className="pgw-sidebar-backdrop" aria-label="Close conversations" onClick={() => setSidebarOpen(false)} />}
			{sidebarOpen && <aside id="pgw-conversations" className="pgw-conversations">
				<div className="pgw-sidebar-heading"><span>Conversations</span><button type="button" className="pgw-icon-button" aria-label="Close conversations" onClick={() => setSidebarOpen(false)}><WorkspaceIcon name="close" width={17} height={17} /></button></div>
				<button type="button" className="pgw-outlined-button" disabled={streaming} onClick={newConversation}><WorkspaceIcon name="plus" /> New conversation</button>
				<label className="pgw-search"><WorkspaceIcon name="search" width={16} height={16} /><input ref={searchRef} type="search" placeholder="Search conversations…" aria-label="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
				<p className="pgw-sidebar-caption">This session</p>
				<div className="pgw-conversation-list">{filteredConversations.map((chat) => <div className="pgw-conversation-row" key={chat.id} data-active={chat.id === conversationId}>
					<button type="button" disabled={streaming} onClick={() => openConversation(chat)}>{chat.title}</button>
					<button type="button" className="pgw-icon-button" disabled={streaming} aria-label={`Delete conversation: ${chat.title}`} onClick={() => void forgetConversation(chat.id)}><WorkspaceIcon name="trash" width={15} height={15} /></button>
				</div>)}</div>
				{!filteredConversations.length && <p className="pgw-sidebar-empty">{search ? "No conversations match your search." : "Your conversations will appear here."}</p>}
				<p className="pgw-sidebar-note">Current-page conversations are saved to your account when possible.</p>
				{serverConversations.length > 0 && <>
					<p className="pgw-sidebar-caption">Saved on the server</p>
					<div className="pgw-conversation-list">{serverConversations.map((session) => <div className="pgw-conversation-row" key={session.uuid}>
						<button type="button" disabled={streaming} onClick={() => void resumeServerSession(session)}>{session.title}</button>
						<button type="button" className="pgw-icon-button" disabled={streaming} aria-label={`Forget server-saved conversation: ${session.title}`} onClick={() => { resumeRef.current?.abort(); void forgetConversation(null, session.uuid); }}><WorkspaceIcon name="trash" width={15} height={15} /></button>
					</div>)}</div>
					<p className="pgw-sidebar-note">Saved messages and tool activity can be restored here. Older sessions may contain only a checkpoint.</p>
				</>}
			</aside>}
			<div className="pgw-main">
				<header className="pgw-topbar">
					<button type="button" className="pgw-wordmark" onClick={() => setView("chat")}>Spectre <span>Playground</span></button>
					<div className="pgw-topbar-actions"><button type="button" className="pgw-icon-button" aria-label="Open web instructions" title="Web instructions" aria-haspopup="dialog" onClick={() => setHelpOpen(true)}><WorkspaceIcon name="help" width={18} /></button><DesktopAppDownload /></div>
				</header>
				{view !== "chat" && <div className="pgw-view-toolbar"><button type="button" className="pgw-text-button" onClick={() => setView("chat")}>← Back to chat</button></div>}
				{view === "chat" && workspaceOpen && <div className="pgw-workspace-toggle"><span>Advanced · manual execution</span><button type="button" className="pgw-text-button" aria-expanded={workspaceOpen} aria-controls="pgw-manual-workspace" onClick={() => setWorkspaceOpen(false)}>Close workspace</button></div>}
				<PlaygroundRuntime open={workspaceOpen && view === "chat"} />
				{view === "activity" && <div className="pgw-page-scroll"><PlaygroundRunHistory sessionUuid={sessionIds.current.get(conversationId)} /></div>}
				{view === "review" && <div className="pgw-page-scroll"><PlaygroundAgentReview key={`${conversationId}:${model}:${preferences.inputContextTokens}:${sessionIds.current.get(conversationId) || ""}`} context={{ model, inputContextTokens: preferences.inputContextTokens, sessionUuid: sessionIds.current.get(conversationId) }} /></div>}
				{view === "settings" && <div className="pgw-page-scroll"><PlaygroundSettings preferences={preferences} thinkingAllowed={thinkingAllowed} streaming={streaming} onSave={savePreferences} onExport={exportConversation} onImport={importConversation} hasMessages={messages.length > 0} /></div>}
				{view === "prices" && <div className="pgw-page-scroll"><section className="pgw-prices"><h1><WorkspaceIcon name="prices" width={28} height={28} /> API Prices</h1><p>Every model. 128K context. Image/video attachments use Vision; audio uses Audio.</p><span className="pgw-pricing-unit">RON per 1M tokens · input / output</span><PlaygroundModelLineup tier={tier} access={access} disclosure={false} /></section></div>}
				{view === "chat" && <div className={`pgw-chat${empty ? " pgw-chat-empty" : ""}`}>
					{!empty && <div className="pgw-scroll" ref={scrollRef} role="log" aria-label="Conversation" aria-busy={streaming}>
						<div className="pgw-transcript">{messages.map((message, index) => {
							const isCurrent = streaming && index === messages.length - 1 && message.role === "assistant";
							const display = message.role === "assistant" ? displayToolText(message.content, isCurrent) : { text: message.content, names: [] };
							return <article key={message.id} className={`pgw-message pgw-message-${message.role}`} data-failed={message.failed}>
								{message.role === "user" ? <><p className="pgw-user-text">{message.content}</p>{message.sources?.length ? <div className="pgw-message-sources">{message.sources.map((source, sourceIndex) => <span key={sourceIndex}><WorkspaceIcon name={source.kind === "github" ? "github" : "paperclip"} width={13} />{source.name}</span>)}</div> : null}</> : <>
									{message.reasoning && <details className="pgw-reasoning"><summary>Thinking</summary><PlaygroundMessageContent text={message.reasoning} /></details>}
									{message.tools?.map(tool => <details className="pgw-tool-activity" key={tool.id}><summary><WorkspaceIcon name="settings" width={15} height={15} /> <strong>{tool.name}</strong><span>{tool.status === "finished" ? "finished" : "proposed"}</span></summary><pre>{tool.arguments}</pre>{tool.result && <pre>{tool.result}</pre>}</details>)}
									{display.names.map((name, i) => <details className="pgw-tool-activity" key={`${name}:${i}`}><summary><strong>{name}</strong><span>Not executed</span></summary><p>The model wrote tool syntax as text. It was not a verified tool call and was not executed.</p></details>)}
									{display.text ? <PlaygroundMessageContent text={display.text} /> : isCurrent && !display.names.length ? <p className="pgw-generating" role="status"><span /><span /><span /><em>{modelLoad.isLoading ? "Loading model…" : "Thinking…"}</em></p> : null}
									{!isCurrent && message.webSources?.length ? <div className="pgw-web-sources" aria-label="Web sources"><span className="pgw-web-sources-label"><WorkspaceIcon name="search" width={13} height={13} /> Web sources</span>{message.webSources.map((source, sourceIndex) => <a key={`${source.url}:${sourceIndex}`} href={source.url} target="_blank" rel="noreferrer nofollow">{source.title}</a>)}</div> : null}
									{!isCurrent && message.documents?.length ? <div className="pgw-message-docs" aria-label="Saved documents">{message.documents.map((document) => <button key={document.id} type="button" className="pgw-document-chip" title="Download document" onClick={() => void downloadDocument(document.id, document.name)}><WorkspaceIcon name="file" width={13} height={13} /><span>{document.name}</span><em>{formatDocumentBytes(document.bytes)}</em><WorkspaceIcon name="download" width={13} height={13} /></button>)}</div> : null}
									{!isCurrent && <div className="pgw-message-meta"><span className="pgw-model-badge"><WorkspaceIcon name="model" width={14} height={14} /> {MODEL_LABEL_BY_KEY[message.model || model]}</span>{message.inputTokens !== undefined && <span>{message.inputTokens.toLocaleString()} in</span>}{message.outputTokens !== undefined && <span>{message.outputTokens.toLocaleString()} out</span>}{message.seconds !== undefined && <span>{message.seconds.toFixed(1)} s</span>}{formatTokensPerSecond(message.outputTokens, message.seconds) && <span>{formatTokensPerSecond(message.outputTokens, message.seconds)}</span>}</div>}
								</>}
								{!isCurrent && <div className="pgw-message-actions">
									<button type="button" className="pgw-icon-button" aria-label="Copy message" title="Copy" onClick={async () => { try { await navigator.clipboard.writeText(message.content); setCopied(message.id); window.setTimeout(() => setCopied(null), 2000); } catch { setNotice("Your browser could not copy this message."); } }}><WorkspaceIcon name={copied === message.id ? "check" : "copy"} width={17} height={17} /></button>
									{message.role === "assistant" && message.content && <button type="button" className="pgw-icon-button" aria-label="Save reply as a document" title="Save as document" disabled={savingDocument === message.id} onClick={() => void saveReplyAsDocument(message)}><WorkspaceIcon name="file" width={17} height={17} /></button>}
									{message.role === "user" && <button type="button" className="pgw-icon-button" aria-label="Edit prompt" title="Edit prompt · Chat mode only" disabled={streaming || agentBusy || mode !== "chat"} onClick={() => { setInput(message.content); setEditingFrom(index); inputRef.current?.focus(); }}><WorkspaceIcon name="edit" width={17} height={17} /></button>}
									{message.role === "assistant" && index > 0 && messages[index - 1].role === "user" && <button type="button" className="pgw-icon-button" aria-label="Regenerate response" title="Regenerate · Chat mode only" disabled={streaming || agentBusy || mode !== "chat"} onClick={() => void send(messages[index - 1].content, index - 1)}><WorkspaceIcon name="retry" width={17} height={17} /></button>}
									<button type="button" className="pgw-icon-button" aria-label="Delete message" title="Delete message" disabled={streaming} onClick={() => { setMessages((previous) => previous.filter((item) => item.id !== message.id)); setEditingFrom(null); }}><WorkspaceIcon name="trash" width={17} height={17} /></button>
								</div>}
							</article>;
						})}</div>
					</div>}
					<div className="pgw-composer-area" ref={composerRef}>
						{empty && <div className="pgw-welcome"><span className="pgw-welcome-emblem"><WorkspaceIcon name="model" width={28} height={28} /></span><h1>Hello there</h1><p>What would you like to explore?</p></div>}
						{balanceGate && <AiBalanceExhausted gate={balanceGate} />}
						{notice && <p className="pgw-notice" role="status">{notice}</p>}
						<AgentInteractions workspace={agent} />
						{mode !== "chat" && agentState.error && <p className="pgw-notice" role="status">{agentState.error}</p>}
						<div className="pgw-context-status" aria-live="polite">
							{contextState?.compacted && <details><summary>Context compacted · {contextState.tokensBefore.toLocaleString()} → {contextState.tokensAfter.toLocaleString()} tokens</summary><p>Original messages are unchanged. Summary inference is metered.</p><pre>{contextState.summary}</pre></details>}
						</div>
						<form className="pgw-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
							{editingFrom !== null && <div className="pgw-editing-banner"><span>Editing message · sending will replace this reply and any messages after it.</span><button type="button" className="pgw-text-button" onClick={() => { setEditingFrom(null); setInput(""); }}>Cancel</button></div>}
							{attachments.sources.length > 0 && <SourceList sources={attachments.sources} onRemove={attachments.remove} disabled={streaming} />}
							{recommendations.map((item) => <div className="pgw-model-suggestion" role="status" key={item.key}><span>{item.description}</span><button type="button" className="pgw-text-button" disabled={streaming} onClick={() => savePreferences({ ...preferences, model: item.key })}>Use {MODEL_LABEL_BY_KEY[item.key]}</button></div>)}
							{attachments.error && <p className="pgw-notice" role="alert">{attachments.error}</p>}
							<textarea ref={inputRef} rows={2} aria-label="Message" placeholder={mode === "chat" ? "Ask anything…" : mode === "plan" ? "Explore a project or plan a change…" : "Describe what you want to build…"} value={input} maxLength={8000} disabled={streaming || agentBusy} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!streaming) attachments.addFiles(event.dataTransfer.files); }} onPaste={(event) => { if (event.clipboardData.files.length && !streaming) { event.preventDefault(); attachments.addFiles(event.clipboardData.files); } }} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && preferences.enterToSend) { event.preventDefault(); submit(); } }} />
							<div className="pgw-composer-toolbar">
								<div className="pgw-composer-left">
									<WorkspacePicker label="Playground mode" value={mode} icon={mode === "build" ? "edit" : null} disabled={streaming || agentBusy} options={[{ key: "chat", label: "Chat" }, { key: "plan", label: "Plan" }, { key: "build", label: "Build" }]} onChange={value => { setMode(value === "build" ? "build" : value === "plan" ? "plan" : "chat"); setNotice(""); }} />
									<AttachmentMenu disabled={streaming} onFiles={attachments.addFiles} />
									<button type="button" ref={githubRef} className="pgw-icon-button" aria-label="Add GitHub project" title="Add GitHub project" disabled={streaming} onClick={() => setGithubOpen(true)}><WorkspaceIcon name="github" /></button>
									<WorkspacePicker label="Input context" icon={null} disabled={streaming} value={String(preferences.inputContextTokens)} options={CONTEXT_LEVELS.map(level => ({ key: String(level), label: formatContextTokens(level) }))} onChange={value => savePreferences({ ...preferences, inputContextTokens: Number(value) })} />
									<WorkspacePicker label="Compaction mode" icon="settings" disabled={streaming} value={preferences.compactionMode} options={COMPACTION_OPTIONS} onChange={value => savePreferences({ ...preferences, compactionMode: compactionMode(value) })} />
								</div>
								<div className="pgw-composer-right">
									{thinkingAllowed && <button type="button" className="pgw-icon-button pgw-thinking-toggle" aria-label="Thinking mode" title={mode !== "chat" ? "Thinking · controlled by the agent model in Plan and Build" : `Thinking · ${preferences.thinking ? "on" : "off"}`} aria-pressed={preferences.thinking} disabled={streaming || agentBusy || mode !== "chat"} onClick={() => savePreferences({ ...preferences, thinking: !preferences.thinking })}><WorkspaceIcon name="brain" width={18} height={18} /></button>}
									<span className="pgw-context-ring-wrap" title={contextPercent === null || measuredInputTokens === undefined ? "Context usage: not measured yet" : `Last measured input: ${measuredInputTokens.toLocaleString()} / ${formatContextTokens(measuredInputLimit)} · ${contextPercent}%`}><svg className="pgw-context-ring" viewBox="0 0 32 32" width="20" height="20" role="img" aria-label={contextPercent === null ? "Context usage: not measured yet" : `Last measured input context: ${contextPercent}% used`}><circle cx="16" cy="16" r="11" fill="none" strokeWidth="3" className="pgw-context-ring-track" /><circle cx="16" cy="16" r="11" fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={2 * Math.PI * 11} strokeDashoffset={2 * Math.PI * 11 * (1 - (contextPercent ?? 0) / 100)} transform="rotate(-90 16 16)" className="pgw-context-ring-value" data-level={contextPercent !== null && contextPercent >= 95 ? "high" : contextPercent !== null && contextPercent >= 80 ? "elevated" : "ok"} /></svg></span>
									<WorkspacePicker label="Model" disabled={streaming} value={model} options={PLAYGROUND_MODEL_KEYS.map(key => ({ key, label: MODEL_LABEL_BY_KEY[key] }))} onChange={value => savePreferences({ ...preferences, model: value as PlaygroundPreferences["model"] })} />
									{streaming ? <button type="button" className="pgw-send-button" aria-label="Stop generation" title="Stop generation" onClick={() => { abortRef.current?.abort(); if (!abortRef.current) void agent.stop(); }}><WorkspaceIcon name="stop" /></button> : <button type="submit" className="pgw-send-button" aria-label="Send message" title="Send message" disabled={agentBusy || (!input.trim() && !attachments.contexts.length) || !attachments.ready || (mode !== "chat" && agentState.requiresReset)}><WorkspaceIcon name="send" /></button>}
								</div>
							</div>
						</form>
						<div className="pgw-mode-guidance" role="status">{mode === "chat" ? "Chat · answers and attachments; ask to search the web" : mode === "plan" ? "Plan · read and research without changing files" : "Build · propose staged file changes for approval; no code execution"}</div>
						<div className="pgw-composer-footnote">{streaming && modelLoad.isLoading ? <span role="status">Loading {MODEL_LABEL_BY_KEY[model]} · {modelLoad.progress}%</span> : <span>Hosted model <i>·</i> 128K context <i>·</i> {access === "addon" ? "Wallet billing" : `${tier.toUpperCase()} plan`}</span>}{mode === "chat" && messages.length >= 2 && <button type="button" className="pgw-text-button" disabled={streaming} aria-pressed={compactNext} onClick={() => setCompactNext(!compactNext)}>{compactNext ? "Compaction queued ✓" : "Compact next send"}</button>}</div>
					</div>
				</div>}
			</div>
			{githubOpen && <GithubProjectDialog onAdd={attachments.addGithub} onClose={() => { setGithubOpen(false); window.requestAnimationFrame(() => githubRef.current?.focus()); }} />}
			{helpOpen && <PlaygroundHelp advancedDisabled={streaming} onClose={() => setHelpOpen(false)} onManual={() => { setHelpOpen(false); setWorkspaceOpen(true); setView("chat"); }} onPreview={() => { setHelpOpen(false); setView("review"); }} />}
		</div>
	);
}
