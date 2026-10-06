"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { isSignedIn, subscribeAuthState } from "@/lib/authState";
import { fetchCurrentAccount } from "@/lib/clientAuth";
import { buildPageHref } from "@/lib/pages";
import { useModelPrewarm } from "@/hooks/useModelPrewarm";
import { useModelLoadStatus } from "@/hooks/useModelLoadStatus";
import PlaygroundModelLineup from "./PlaygroundModelLineup";
import ModelLoadingBar from "./ModelLoadingBar";
import {
	MODEL_DESCRIPTION_BY_KEY,
	MODEL_LABEL_BY_KEY,
	allowedTextModelsForTier,
	normalizeModelTier,
	tierCanUseThinkingModel,
	TEXT_MODEL_230M,
	type TextModelKey,
	type UserSubscriptionTier,
} from "@/lib/modelAccess";
import { ArrowNarrowDownIcon, SparklesIcon } from "@/icons";
import { tierCanUsePlayground } from "@/lib/entitlements";

type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	reasoning?: string;
	model?: TextModelKey;
	failed?: boolean;
};

const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;
const MAX_TOKENS_CEILING = 2048;


function getOrCreateFingerprint(): string {
	if (typeof window === "undefined") return "";
	const KEY = "kafelot_fp";
	try {
		const existing = window.localStorage.getItem(KEY);
		if (existing) return existing;
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		const generated = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
		window.localStorage.setItem(KEY, generated);
		return generated;
	} catch {
		return "";
	}
}

export default function PlaygroundContent() {
	const isLoggedIn = useSyncExternalStore(subscribeAuthState, isSignedIn, () => false);

	const [tier, setTier] = useState<UserSubscriptionTier | null>(null);
	const [resolved, setResolved] = useState(false);
	const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);

	// Controls
	const [model, setModel] = useState<TextModelKey | null>(null);
	const [systemPrompt, setSystemPrompt] = useState("");
	const [temperature, setTemperature] = useState(0.7);
	const [maxTokens, setMaxTokens] = useState(512);
	const [thinking, setThinking] = useState(false);

	// Conversation
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [streaming, setStreaming] = useState(false);
	const [streamingText, setStreamingText] = useState("");
	const [streamingReasoning, setStreamingReasoning] = useState("");

	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const nextIdRef = useRef(0);

	const nextId = useCallback(() => {
		nextIdRef.current += 1;
		return `pg_${Date.now()}_${nextIdRef.current}`;
	}, []);

	// ---- Session + tier -------------------------------------------------

	useEffect(() => {
		let cancelled = false;
		void fetchCurrentAccount().then((account) => {
			if (cancelled) return;
			setResolved(true);
			setTier(normalizeModelTier(account?.subscription ?? "none"));
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const allowedModels = useMemo<TextModelKey[]>(
		() => (tier ? allowedTextModelsForTier(tier) : []),
		[tier],
	);

	const hasPlaygroundAccess = tierCanUsePlayground(tier);

	// Default to the strongest model the plan allows.
	useEffect(() => {
		if (allowedModels.length === 0) return;
		setModel((current) => (current && allowedModels.includes(current) ? current : allowedModels[allowedModels.length - 1]));
	}, [allowedModels]);

	// Thinking is MAX/ULTIMATE-only; never leave the toggle on for a lower plan.
	const thinkingAllowed = tier ? tierCanUseThinkingModel(tier) : false;
	useEffect(() => {
		if (!thinkingAllowed) setThinking(false);
	}, [thinkingAllowed]);

	const prewarm = useModelPrewarm({ modelKey: hasPlaygroundAccess ? model : null, enabled: hasPlaygroundAccess });
	// Only one chat model is resident at a time, so selecting a different model
	// means a swap. Track it so the transcript can show determinate progress
	// instead of a stalled-looking empty stream.
	const modelLoad = useModelLoadStatus(hasPlaygroundAccess ? model : null);
	// Pulled out as its own binding: `modelLoad` is a fresh object every render, so
	// depending on it would rebuild the send callback continuously. `waitUntilLoaded`
	// is a useCallback and is stable.
	const { waitUntilLoaded } = modelLoad;

	// ---- Streaming ------------------------------------------------------

	const stopStream = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setStreaming(false);
		setStreamingText("");
		setStreamingReasoning("");
	}, []);

	useEffect(() => stopStream, [stopStream]);

	useEffect(() => {
		const node = transcriptRef.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
	}, [messages, streamingText]);

	const send = useCallback(async () => {
		const prompt = input.trim();
		if (!prompt || streaming || !model) return;

		const userMessage: ChatMessage = { id: nextId(), role: "user", content: prompt };
		const assistantId = nextId();
		setMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", content: "" }]);
		setInput("");
		setStreaming(true);
		setStreamingText("");
		setStreamingReasoning("");
		setUpgradeMessage(null);

		const controller = new AbortController();
		abortRef.current = controller;

		try {
			// Only one model is resident at a time, so a swap may be pending. Wait it
			// out here instead of letting the gateway answer 429 after
			// AI_QUEUE_WAIT_SECONDS -- the progress bar above is what the user is
			// watching, so gating the request on it is the whole point of option (b).
			if (!(await waitUntilLoaded())) {
				throw new Error(
					`${MODEL_LABEL_BY_KEY[model]} could not be loaded in time. Please try again.`,
				);
			}

			const response = await fetch("/api/playground/chat", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-kafelot-fingerprint": getOrCreateFingerprint(),
					"x-kafelot-scope": "general",
				},
				body: JSON.stringify({
					message: prompt,
					system_prompt: systemPrompt,
					model,
					temperature,
					max_tokens: maxTokens,
					thinking,
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { message?: string } | null;
				setMessages((prev) =>
					prev.map((m) =>
						m.id === assistantId
							? { ...m, content: payload?.message || `Request failed (${response.status}).`, failed: true }
							: m,
					),
				);
				return;
			}

			if (!response.body) {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === assistantId ? { ...m, content: "The AI runtime returned no response stream.", failed: true } : m,
					),
				);
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let accumulated = "";
			let reasoningBuffer = "";
			// Set from the terminal `done` frame when the model returned nothing.
			let notice = "";

			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				// SSE frames are separated by a blank line; keep the remainder
				// buffered until the next complete frame arrives.
				let boundary = buffer.indexOf("\n\n");
				while (boundary !== -1) {
					const frame = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);

					for (const rawLine of frame.split("\n")) {
						if (!rawLine.startsWith("data:")) continue;
						const data = rawLine.slice(5).trim();
						if (!data || data === "[DONE]") continue;
try {
						const event = JSON.parse(data) as {
							delta?: string;
							reasoning?: string;
							error?: string;
							notice?: string;
						};
						if (event.delta) {
							accumulated += event.delta;
							setStreamingText(accumulated);
						} else if (event.reasoning) {
							// LFM 2.5 thinks in `reasoning_content`; the server only
							// forwards it when thinking mode is on.
							reasoningBuffer += event.reasoning;
							setStreamingReasoning(reasoningBuffer);
						} else if (event.notice) {
							// The model produced no content at all -- usually the whole
							// token budget went into reasoning. Surface it, otherwise the
							// user just gets an empty bubble with no explanation.
							notice = event.notice;
						} else if (event.error) {
							accumulated += `\n[error: ${event.error}]`;
							setStreamingText(accumulated);
						}
					} catch {
						// Ignore malformed frame rather than killing the stream.
					}
				}


					boundary = buffer.indexOf("\n\n");
				}
			}

			setMessages((prev) =>
				prev.map((m) =>
					m.id === assistantId
						? {
								...m,
								// The server explains an all-reasoning response on the `done`
								// frame, which beats a bare "(empty response)".
								content: accumulated || notice || "(empty response)",
								reasoning: reasoningBuffer || undefined,
								model,
								failed: !accumulated,
							}
						: m,
				),
			);
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === assistantId ? { ...m, content: m.content || "(stopped)", model, failed: !m.content } : m,
					),
				);
			} else {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === assistantId
							? { ...m, content: err instanceof Error ? err.message : "Unexpected error.", failed: true }
							: m,
					),
				);
			}
		} finally {
			abortRef.current = null;
			setStreaming(false);
			setStreamingText("");
			setStreamingReasoning("");
		}
	}, [input, streaming, model, systemPrompt, temperature, maxTokens, thinking, nextId, waitUntilLoaded]);

	const clearTranscript = useCallback(() => {
		stopStream();
		setMessages([]);
	}, [stopStream]);

	// ---- Gate -----------------------------------------------------------

	if (!resolved) {
		return (
			<main className="playground-page">
				<div className="playground-loading">Checking your plan…</div>
			</main>
		);
	}

	if (!isLoggedIn) {
		return (
			<main className="playground-page">
				<section className="playgate-card">
					<h1>Spectre Playground</h1>
					<p>Sign in to use the Playground.</p>
					<Link className="playground-cta" href={buildPageHref("account")}>
						Go to account
					</Link>
					{/* Shown signed-out too: a visitor who cannot sign in is exactly the
					    person deciding which plan to buy. */}
					<PlaygroundModelLineup tier={tier ?? null} textOnly />
				</section>
			</main>
		);
	}

	if (!hasPlaygroundAccess) {
		return (
			<main className="playground-page">
				<section className="playgate-card">
					<SparklesIcon size={22} />
					<h1>Spectre Playground</h1>
					<p>
						The Playground is included with <strong>MAX</strong> and <strong>ULTIMATE</strong> plans. Upgrade to chat
						directly with the GGUF models, tune temperature and system prompts, and stream tokens.
					</p>
					<Link className="playground-cta" href={buildPageHref("subscription")}>
						View plans
					</Link>
					{upgradeMessage ? <p className="playground-upgrade-error">{upgradeMessage}</p> : null}
					<PlaygroundModelLineup tier={tier ?? null} textOnly />
				</section>
			</main>
		);
	}

	return (
		<main className="playground-page">
			<header className="playground-header">
				<div>
					<h1>Spectre Playground</h1>
					<p className="playground-subtitle">
						Direct access to the GGUF models. No retrieval layer, no fallbacks.
					</p>
				</div>
				<div className="playground-header-actions">
					<span className="playground-ready" data-status={prewarm.status}>
						{prewarm.status === "idle" ? "" : prewarm.label}
					</span>
					{model ? <ModelLoadingBar modelKey={model} state={modelLoad} compact /> : null}
					<button type="button" className="playground-ghost-button" onClick={clearTranscript} disabled={messages.length === 0}>
						Clear
					</button>
				</div>
			</header>

			<section className="playground-controls" aria-label="Model settings">
				<label className="playground-field">
					<span>Model</span>
					<select
						value={model ?? ""}
						onChange={(event) => setModel(event.target.value as TextModelKey)}
						disabled={streaming}
					>
						{allowedModels.map((key) => (
							<option key={key} value={key}>
								{MODEL_LABEL_BY_KEY[key]} — {MODEL_DESCRIPTION_BY_KEY[key]}
							</option>
						))}
					</select>
				</label>

				<label className="playground-field">
					<span>
						Temperature <em>{temperature.toFixed(2)}</em>
					</span>
					<input
						type="range"
						min={MIN_TEMPERATURE}
						max={MAX_TEMPERATURE}
						step={0.05}
						value={temperature}
						disabled={streaming}
						onChange={(event) => setTemperature(Number.parseFloat(event.target.value))}
					/>
				</label>

				<label className="playground-field">
					<span>
						Max tokens <em>{maxTokens}</em>
					</span>
					<input
						type="range"
						min={64}
						max={MAX_TOKENS_CEILING}
						step={64}
						value={maxTokens}
						disabled={streaming}
						onChange={(event) => setMaxTokens(Number.parseInt(event.target.value, 10))}
					/>
				</label>

				<label className="playground-field playground-field-wide">
					<span>System prompt</span>
					<textarea
						rows={2}
						value={systemPrompt}
						maxLength={2000}
						disabled={streaming}
						placeholder="You are a helpful assistant."
						onChange={(event) => setSystemPrompt(event.target.value)}
					/>
				</label>

				{thinkingAllowed && (
					<label className="playground-toggle">
						<input
							type="checkbox"
							checked={thinking}
							disabled={streaming}
							onChange={(event) => setThinking(event.target.checked)}
						/>
						<span>Thinking mode</span>
					</label>
				)}
			</section>

			<section className="playground-transcript" ref={transcriptRef} aria-live="polite" aria-busy={streaming}>
				{messages.length === 0 && !streaming && (
					<p className="playground-empty">Send a prompt to start. The model replies token by token.</p>
				)}

				{messages.map((message) => (
					<article key={message.id} className={`playground-bubble playground-bubble-${message.role}`}>
						<header>
							<span>{message.role === "user" ? "You" : MODEL_LABEL_BY_KEY[message.model ?? TEXT_MODEL_230M]}</span>
						</header>
						{message.reasoning ? (
							<details className="playground-reasoning">
								<summary>Thinking</summary>
								<pre>{message.reasoning}</pre>
							</details>
						) : null}
						<pre>{message.content || (message.id === messages[messages.length - 1]?.id ? streamingText : "")}</pre>
					</article>
				))}

				{streaming && (streamingText || streamingReasoning) && messages[messages.length - 1]?.content === "" && (
					<article className="playground-bubble playground-bubble-assistant">
						<header>
							<span>{MODEL_LABEL_BY_KEY[model ?? TEXT_MODEL_230M]}</span>
						</header>
						{streamingReasoning ? (
							<details className="playground-reasoning" open>
								<summary>Thinking</summary>
								<pre>{streamingReasoning}</pre>
							</details>
						) : null}
						<pre>
							{streamingText}
							<span className="playground-caret" />
						</pre>
					</article>
				)}
			</section>

			<form
				className="playground-composer"
				onSubmit={(event) => {
					event.preventDefault();
					void send();
				}}
			>
				<textarea
					rows={2}
					value={input}
					disabled={streaming}
					placeholder={model ? `Message ${MODEL_LABEL_BY_KEY[model]}…` : "Select a model first…"}
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void send();
						}
					}}
				/>
				{streaming ? (
					<button type="button" className="playground-stop" onClick={stopStream}>
						Stop
					</button>
				) : (
					<button type="submit" className="playground-send" disabled={!input.trim() || !model}>
						Send
					</button>
				)}
			</form>

			<footer className="playground-footer">
				<ArrowNarrowDownIcon size={14} />
				<span>
					{tier ? tier.toUpperCase() : ""} plan · {MODEL_LABEL_BY_KEY[model ?? TEXT_MODEL_230M]} · prompts count toward your
					Kafelot allowance
				</span>
			</footer>

			{/* The picker above only lists what this plan may run, so the lineup also
			    shows what exists and what a higher plan would add. */}
			<PlaygroundModelLineup tier={tier ?? null} textOnly />
		</main>
	);
}
