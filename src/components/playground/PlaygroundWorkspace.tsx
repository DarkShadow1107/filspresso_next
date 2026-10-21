"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GithubIcon } from "@/icons";
import { ALL_TEXT_MODEL_KEYS, MAX_TOKENS_LEVELS, MODEL_FILE_BY_KEY, MODEL_LABEL_BY_KEY, formatContextTokens, isTextModelKey, tierCanUseThinkingModel, type UserSubscriptionTier } from "@/lib/modelAccess";
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

type Message = {
	id: string;
	role: "user" | "assistant";
	content: string;
	reasoning?: string;
	model?: PlaygroundPreferences["model"];
	failed?: boolean;
	seconds?: number;
	outputTokens?: number;
};
type Conversation = { id: string; title: string; messages: Message[] };
type StreamEvent = { delta?: string; reasoning?: string; notice?: string; error?: string; usage?: { completion_tokens?: number } };
const PREFERENCES_KEY = "filspresso_playground_preferences_v1";
const titleFor = (messages: Message[]) => messages.find((message) => message.role === "user")?.content.slice(0, 54) || "New conversation";
const quantFor = (model: PlaygroundPreferences["model"]) => MODEL_FILE_BY_KEY[model].match(/(Q\d[^.]+)\.gguf$/)?.[1] || "GGUF";

export default function PlaygroundWorkspace({ tier, access }: { tier: UserSubscriptionTier; access: SpectreAccessState }) {
	const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
	const [view, setView] = useState<"chat" | "settings" | "prices">("chat");
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
	const [actionsOpen, setActionsOpen] = useState(false);
	const [notice, setNotice] = useState("");
	const shellRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const abortRef = useRef<AbortController | null>(null);
	const actionsRef = useRef<HTMLDivElement>(null);
	const thinkingAllowed = tierCanUseThinkingModel(tier);
	const model = preferences.model;
	useModelPrewarm({ modelKey: model, enabled: true });
	const modelLoad = useModelLoadStatus(model);
	const { waitUntilLoaded } = modelLoad;

	useEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			try {
				const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "null") as Partial<PlaygroundPreferences> | null;
				if (!saved) return;
				setPreferences({
					model: typeof saved.model === "string" && isTextModelKey(saved.model) ? saved.model : DEFAULT_PREFERENCES.model,
					maxTokens: typeof saved.maxTokens === "number" && MAX_TOKENS_LEVELS.includes(saved.maxTokens) ? saved.maxTokens : DEFAULT_PREFERENCES.maxTokens,
					thinking: thinkingAllowed && saved.thinking === true,
					textSize: saved.textSize === "small" || saved.textSize === "large" ? saved.textSize : "standard",
					showStats: saved.showStats !== false,
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
		const measure = () => shellRef.current?.style.setProperty("--pgw-nav-height", `${Math.ceil(navbar.getBoundingClientRect().height)}px`);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(navbar);
		return () => observer.disconnect();
	}, []);
	useEffect(() => () => abortRef.current?.abort(), []);
	useEffect(() => {
		const node = scrollRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [messages]);
	useEffect(() => {
		const node = inputRef.current;
		if (!node) return;
		node.style.height = "auto";
		node.style.height = `${Math.min(220, Math.max(65, node.scrollHeight))}px`;
	}, [input, view]);
	useEffect(() => {
		if (!actionsOpen) return;
		const close = (event: PointerEvent) => { if (!actionsRef.current?.contains(event.target as Node)) setActionsOpen(false); };
		document.addEventListener("pointerdown", close);
		return () => document.removeEventListener("pointerdown", close);
	}, [actionsOpen]);
	useEffect(() => {
		const escape = (event: KeyboardEvent) => {
			if (event.key === "Escape") { setActionsOpen(false); setSidebarOpen(false); }
		};
		document.addEventListener("keydown", escape);
		return () => document.removeEventListener("keydown", escape);
	}, []);

	const savePreferences = (next: PlaygroundPreferences) => {
		const safe = { ...next, thinking: thinkingAllowed && next.thinking };
		setPreferences(safe);
		try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(safe)); return true; } catch { return false; }
	};
	const rememberCurrent = () => {
		if (!messages.length) return;
		setConversations((previous) => [{ id: conversationId, title: titleFor(messages), messages }, ...previous.filter((chat) => chat.id !== conversationId)].slice(0, 30));
	};
	const newConversation = () => {
		if (abortRef.current) return;
		rememberCurrent();
		setConversationId(crypto.randomUUID());
		setMessages([]);
		setInput("");
		setEditingFrom(null);
		setBalanceGate(null);
		setView("chat");
		setActionsOpen(false);
		setNotice("");
		window.requestAnimationFrame(() => inputRef.current?.focus());
	};
	const openConversation = (chat: Conversation) => {
		if (streaming || chat.id === conversationId) { setView("chat"); return; }
		rememberCurrent();
		setConversationId(chat.id);
		setMessages(chat.messages);
		setView("chat");
		setInput("");
		setEditingFrom(null);
		setBalanceGate(null);
		setSidebarOpen(false);
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
		setActionsOpen(false);
	};
	const importConversation = async (file: File) => {
		if (streaming) return;
		if (file.size > 2 * 1024 * 1024) throw new Error("Please choose a JSON file smaller than 2 MB.");
		const data = JSON.parse(await file.text()) as { messages?: unknown };
		if (!Array.isArray(data.messages) || !data.messages.length || data.messages.length > 200) throw new Error("That file must contain between 1 and 200 messages.");
		const imported: Message[] = data.messages.map((raw: unknown) => {
			if (!raw || typeof raw !== "object") throw new Error("The file contains an invalid message.");
			const row = raw as Record<string, unknown>;
			if ((row.role !== "user" && row.role !== "assistant") || typeof row.content !== "string") throw new Error("The file contains an invalid message.");
			return { id: crypto.randomUUID(), role: row.role, content: row.content, reasoning: typeof row.reasoning === "string" ? row.reasoning : undefined, model: typeof row.model === "string" && isTextModelKey(row.model) ? row.model : undefined };
		});
		rememberCurrent();
		setConversationId(crypto.randomUUID());
		setMessages(imported);
		setInput("");
		setEditingFrom(null);
		setBalanceGate(null);
		setView("chat");
	};

	const send = useCallback(async (promptOverride?: string, replaceFrom?: number) => {
		const prompt = (promptOverride ?? input).trim();
		if (!prompt || abortRef.current) return;
		const controller = new AbortController();
		abortRef.current = controller;
		const assistantId = crypto.randomUUID();
		const replaceIndex = replaceFrom ?? editingFrom;
		setMessages((previous) => [...(replaceIndex !== null ? previous.slice(0, replaceIndex) : previous),
			{ id: crypto.randomUUID(), role: "user", content: prompt },
			{ id: assistantId, role: "assistant", content: "", model },
		]);
		setInput("");
		setEditingFrom(null);
		setStreaming(true);
		setNotice("");
		setBalanceGate(null);
		let accumulated = "";
		let reasoning = "";
		let generationStarted = 0;
		let outputTokens: number | undefined;
		const update = (patch: Partial<Message>) => setMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, ...patch } : message));
		try {
			const loaded = await waitUntilLoaded(undefined, controller.signal);
			controller.signal.throwIfAborted();
			if (!loaded.ok) throw new Error(loaded.error || "The model could not be loaded. Please retry.");
			generationStarted = performance.now();
			const response = await fetch("/api/playground/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-kafelot-fingerprint": getOrCreateFingerprint(), "x-kafelot-scope": "general" },
				body: JSON.stringify({ message: prompt, model, max_tokens: preferences.maxTokens, thinking: thinkingAllowed && preferences.thinking }),
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
			const consume = (line: string) => {
				if (!line.startsWith("data:")) return;
				const data = line.slice(5).trim();
				if (!data || data === "[DONE]") return;
				let event: StreamEvent;
				try { event = JSON.parse(data) as StreamEvent; } catch { return; }
				if (event.error) throw new Error(event.error);
				if (event.delta) accumulated += event.delta;
				if (event.reasoning) reasoning += event.reasoning;
				if (event.notice) noticeText = event.notice;
				if (typeof event.usage?.completion_tokens === "number") outputTokens = event.usage.completion_tokens;
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
			update({ content: accumulated || noticeText || "The model returned no answer.", reasoning: reasoning || undefined, failed: !accumulated, outputTokens, seconds: (performance.now() - generationStarted) / 1000 });
		} catch (error) {
			const stopped = controller.signal.aborted;
			update({ content: stopped ? accumulated || "Generation stopped." : accumulated || (error instanceof Error ? error.message : "The request failed."), reasoning: reasoning || undefined, failed: !stopped, outputTokens, seconds: generationStarted ? (performance.now() - generationStarted) / 1000 : undefined });
		} finally {
			if (abortRef.current === controller) { abortRef.current = null; setStreaming(false); }
		}
	}, [input, editingFrom, model, preferences.maxTokens, preferences.thinking, thinkingAllowed, waitUntilLoaded]);

	const allConversations = messages.length ? [{ id: conversationId, title: titleFor(messages), messages }, ...conversations.filter((chat) => chat.id !== conversationId)] : conversations;
	const filteredConversations = allConversations.filter((chat) => `${chat.title} ${chat.messages.map((message) => message.content).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
	const empty = !messages.length;

	return (
		<div className="pgw" ref={shellRef} data-sidebar={sidebarOpen} data-text-size={preferences.textSize}>
			<nav className="pgw-rail" aria-label="Playground navigation">
				<button type="button" className="pgw-icon-button" aria-label="Toggle conversations" aria-expanded={sidebarOpen} aria-controls="pgw-conversations" title="Conversations" onClick={() => setSidebarOpen(!sidebarOpen)}><WorkspaceIcon name="sidebar" /></button>
				<button type="button" className="pgw-icon-button" aria-label="New conversation" title="New conversation" disabled={streaming} onClick={newConversation}><WorkspaceIcon name="new" /></button>
				<button type="button" className="pgw-icon-button" aria-label="Search conversations" title="Search conversations" onClick={() => { setSidebarOpen(true); window.requestAnimationFrame(() => searchRef.current?.focus()); }}><WorkspaceIcon name="search" /></button>
				<button type="button" className="pgw-icon-button" aria-label="API Prices" title="API Prices" aria-pressed={view === "prices"} onClick={() => setView(view === "prices" ? "chat" : "prices")}><WorkspaceIcon name="prices" /></button>
				<button type="button" className="pgw-icon-button" aria-label="Settings" title="Settings" aria-pressed={view === "settings"} onClick={() => setView(view === "settings" ? "chat" : "settings")}><WorkspaceIcon name="settings" /></button>
				<div className="pgw-rail-bottom">
					<a className="pgw-icon-button" href="https://github.com/DarkShadow1107/filspresso_next" target="_blank" rel="noopener noreferrer" aria-label="Filspresso on GitHub" title="Filspresso on GitHub"><GithubIcon size={20} /></a>
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
					<button type="button" className="pgw-icon-button" disabled={streaming} aria-label={`Delete conversation: ${chat.title}`} onClick={() => { setConversations((previous) => previous.filter((item) => item.id !== chat.id)); if (chat.id === conversationId) { setMessages([]); setConversationId(crypto.randomUUID()); } }}><WorkspaceIcon name="trash" width={15} height={15} /></button>
				</div>)}</div>
				{!filteredConversations.length && <p className="pgw-sidebar-empty">{search ? "No conversations match your search." : "Your conversations will appear here."}</p>}
				<p className="pgw-sidebar-note">Kept for this page session. Export a conversation to keep a copy.</p>
			</aside>}
			<div className="pgw-main">
				<header className="pgw-topbar">
					<button type="button" className="pgw-wordmark" onClick={() => setView("chat")}>Spectre <span>Playground</span></button>
					<div className="pgw-topbar-actions"><button type="button" className="pgw-text-button" onClick={() => setView(view === "prices" ? "chat" : "prices")}>API Prices</button><DesktopAppDownload /></div>
				</header>
				{view !== "chat" && <div className="pgw-view-toolbar"><button type="button" className="pgw-text-button" onClick={() => setView("chat")}>← Back to chat</button></div>}
				{view === "settings" && <div className="pgw-page-scroll"><PlaygroundSettings preferences={preferences} thinkingAllowed={thinkingAllowed} streaming={streaming} onSave={savePreferences} onExport={exportConversation} onImport={importConversation} hasMessages={messages.length > 0} /></div>}
				{view === "prices" && <div className="pgw-page-scroll"><section className="pgw-prices"><h1><WorkspaceIcon name="prices" width={28} height={28} /> API Prices</h1><p>Every model. 128K context. Pay for the tokens you use.</p><span className="pgw-pricing-unit">RON per 1M tokens · input / output</span><PlaygroundModelLineup tier={tier} access={access} textOnly disclosure={false} /></section></div>}
				{view === "chat" && <div className={`pgw-chat${empty ? " pgw-chat-empty" : ""}`}>
					{!empty && <div className="pgw-scroll" ref={scrollRef} role="log" aria-label="Conversation" aria-busy={streaming}>
						<div className="pgw-transcript">{messages.map((message, index) => {
							const isCurrent = streaming && index === messages.length - 1 && message.role === "assistant";
							return <article key={message.id} className={`pgw-message pgw-message-${message.role}`} data-failed={message.failed}>
								{message.role === "user" ? <p className="pgw-user-text">{message.content}</p> : <>
									{message.reasoning && <details className="pgw-reasoning"><summary>Thinking</summary><PlaygroundMessageContent text={message.reasoning} /></details>}
									{message.content ? <PlaygroundMessageContent text={message.content} /> : <p className="pgw-generating" role="status"><span /><span /><span /><em>{modelLoad.isLoading ? "Loading model…" : "Thinking…"}</em></p>}
									{!isCurrent && <div className="pgw-message-meta"><span className="pgw-model-badge"><WorkspaceIcon name="model" width={14} height={14} /> {MODEL_LABEL_BY_KEY[message.model || model]} <small>{quantFor(message.model || model)}</small></span>{preferences.showStats && <>{message.outputTokens !== undefined && <span>{message.outputTokens.toLocaleString()} tokens</span>}{message.seconds !== undefined && <span>{message.seconds.toFixed(1)} s</span>}</>}</div>}
								</>}
								{!isCurrent && <div className="pgw-message-actions">
									<button type="button" className="pgw-icon-button" aria-label="Copy message" title="Copy" onClick={async () => { try { await navigator.clipboard.writeText(message.content); setCopied(message.id); window.setTimeout(() => setCopied(null), 2000); } catch { setNotice("Your browser could not copy this message."); } }}><WorkspaceIcon name={copied === message.id ? "check" : "copy"} width={17} height={17} /></button>
									{message.role === "user" && <button type="button" className="pgw-icon-button" aria-label="Edit prompt" title="Edit prompt" disabled={streaming} onClick={() => { setInput(message.content); setEditingFrom(index); inputRef.current?.focus(); }}><WorkspaceIcon name="edit" width={17} height={17} /></button>}
									{message.role === "assistant" && index > 0 && messages[index - 1].role === "user" && <button type="button" className="pgw-icon-button" aria-label="Regenerate response" title="Regenerate" disabled={streaming} onClick={() => void send(messages[index - 1].content, index - 1)}><WorkspaceIcon name="retry" width={17} height={17} /></button>}
									<button type="button" className="pgw-icon-button" aria-label="Delete message" title="Delete message" disabled={streaming} onClick={() => { setMessages((previous) => previous.filter((item) => item.id !== message.id)); setEditingFrom(null); }}><WorkspaceIcon name="trash" width={17} height={17} /></button>
								</div>}
							</article>;
						})}</div>
					</div>}
					<div className="pgw-composer-area">
						{empty && <div className="pgw-welcome"><span className="pgw-welcome-emblem"><WorkspaceIcon name="model" width={28} height={28} /></span><h1>Hello there</h1><p>What would you like to explore?</p></div>}
						{balanceGate && <AiBalanceExhausted gate={balanceGate} />}
						{notice && <p className="pgw-notice" role="status">{notice}</p>}
						<form className="pgw-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
							{editingFrom !== null && <div className="pgw-editing-banner"><span>Editing message · sending will replace this reply and any messages after it.</span><button type="button" className="pgw-text-button" onClick={() => { setEditingFrom(null); setInput(""); }}>Cancel</button></div>}
							<textarea ref={inputRef} rows={2} aria-label="Message" placeholder="Type a message…" value={input} maxLength={8000} disabled={streaming} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && preferences.enterToSend) { event.preventDefault(); void send(); } }} />
							<div className="pgw-composer-toolbar">
								<div className="pgw-composer-left" ref={actionsRef}>
									<button type="button" className="pgw-icon-button pgw-add-button" aria-label="Conversation actions" title="Conversation actions" aria-expanded={actionsOpen} onClick={() => setActionsOpen(!actionsOpen)}><WorkspaceIcon name="plus" /></button>
									{actionsOpen && <div className="pgw-action-menu"><button type="button" onClick={newConversation} disabled={streaming}><WorkspaceIcon name="new" /> New conversation</button><button type="button" onClick={exportConversation} disabled={!messages.length || streaming}><WorkspaceIcon name="download" /> Export conversation</button><button type="button" onClick={() => { setView("settings"); setActionsOpen(false); }}><WorkspaceIcon name="settings" /> Settings</button></div>}
									<button type="button" className="pgw-context-chip" title="Maximum output tokens · open settings" onClick={() => setView("settings")}>{formatContextTokens(preferences.maxTokens)}<span> / 128K</span></button>
								</div>
								<div className="pgw-composer-right">
									{thinkingAllowed && <button type="button" className="pgw-icon-button pgw-thinking-toggle" aria-label="Thinking mode" title="Thinking mode" aria-pressed={preferences.thinking} disabled={streaming} onClick={() => setPreferences({ ...preferences, thinking: !preferences.thinking })}><WorkspaceIcon name="brain" width={18} height={18} /></button>}
									<label className="pgw-model-picker"><WorkspaceIcon name="model" width={16} height={16} /><select aria-label="Model" value={model} disabled={streaming} onChange={(event) => setPreferences({ ...preferences, model: event.target.value as PlaygroundPreferences["model"] })}>{ALL_TEXT_MODEL_KEYS.map((key) => <option key={key} value={key}>{MODEL_LABEL_BY_KEY[key]}</option>)}</select><span className="pgw-quant">{quantFor(model)}</span></label>
									{streaming ? <button type="button" className="pgw-send-button" aria-label="Stop generation" title="Stop generation" onClick={() => abortRef.current?.abort()}><WorkspaceIcon name="stop" /></button> : <button type="submit" className="pgw-send-button" aria-label="Send message" title="Send message" disabled={!input.trim()}><WorkspaceIcon name="send" /></button>}
								</div>
							</div>
						</form>
						<div className="pgw-composer-footnote">{streaming && modelLoad.isLoading ? <span role="status">Loading {MODEL_LABEL_BY_KEY[model]} · {modelLoad.progress}%</span> : <span>Direct model access <i>·</i> 128K context <i>·</i> {access === "addon" ? "Usage billed to your wallet" : `${tier.toUpperCase()} plan`}</span>}</div>
					</div>
					{empty && <p className="pgw-empty-caption">Your prompt. Your model. Room to think.</p>}
				</div>}
			</div>
		</div>
	);
}
