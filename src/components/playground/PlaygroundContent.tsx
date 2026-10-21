"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { AiBalanceExhausted, readBalanceGate, type BalanceGate } from "@/components/ai/AiBalanceExhausted";
import { isSignedIn, subscribeAuthState } from "@/lib/authState";
import { fetchCurrentAccount } from "@/lib/clientAuth";
import { buildPageHref } from "@/lib/pages";
import { useModelPrewarm } from "@/hooks/useModelPrewarm";
import { useModelLoadStatus } from "@/hooks/useModelLoadStatus";
import PlaygroundModelLineup from "./PlaygroundModelLineup";

/** Shared with the line-up so the two never quote different money. */
const ron = (value: number) =>
	`${Number(value || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`;
import ModelLoadingBar from "./ModelLoadingBar";
import {
	MODEL_CONTEXT_TOKENS,
	MODEL_DESCRIPTION_BY_KEY,
	MODEL_LABEL_BY_KEY,
	MAX_TOKENS_LEVELS,
	defaultMaxTokensFor,
	formatContextTokens,
	maxTokensCeilingFor,
	normalizeModelTier,
	tierCanUseThinkingModel,
	TEXT_MODEL_230M,
	type TextModelKey,
	type UserSubscriptionTier,
	ALL_TEXT_MODEL_KEYS,
} from "@/lib/modelAccess";
import { ArrowNarrowDownIcon, GithubIcon, SparklesIcon } from "@/icons";
import { tierCanUsePlayground, SPECTRE_SUBSCRIPTION } from "@/lib/entitlements";
import { getOrCreateFingerprint } from "@/lib/fingerprint";
import DesktopAppDownload from "./DesktopAppDownload";

/**
 * Where the source lives.
 *
 * The Playground is a thin window onto the models, and the models are open
 * source: the button is here so that someone who likes what they are looking
 * at can go and read it.
 */
const GITHUB_URL = "https://github.com/DarkShadow1107/filspresso_next";

type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	reasoning?: string;
	model?: TextModelKey;
	failed?: boolean;
};


export default function PlaygroundContent() {
	const isLoggedIn = useSyncExternalStore(subscribeAuthState, isSignedIn, () => false);

	const [tier, setTier] = useState<UserSubscriptionTier | null>(null);
	const [resolved, setResolved] = useState(false);
	const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);

	// Controls
	const [model, setModel] = useState<TextModelKey | null>(null);
	const [maxTokens, setMaxTokens] = useState(MAX_TOKENS_LEVELS[0]);
	const [thinking, setThinking] = useState(false);

	// Conversation
	const [balanceGate, setBalanceGate] = useState<BalanceGate | null>(null);
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

	// The authoritative answer, fetched from the same service that enforces the gate.
	//
	// Starts as "no" and is only widened by a real response, so a failed or slow lookup
	// shows the paywall rather than a Playground the route would then refuse -- and an
	// add-on holder is never told they need to upgrade.
	const [spectreAccess, setSpectreAccess] = useState<"addon" | "tier" | "none">(
		tierCanUsePlayground(tier) ? "tier" : "none",
	);
	useEffect(() => {
		let cancelled = false;
		fetch("/api/spectre/access", { credentials: "include", cache: "no-store" })
			.then((res) => (res.ok ? res.json() : null))
			.then((body: { hasAccess?: boolean; source?: string } | null) => {
				if (cancelled || !body?.hasAccess) return;
				setSpectreAccess(body.source === "addon" ? "addon" : "tier");
			})
			.catch(() => {
				// Silent: the tier-derived default stands, which under-claims rather than
				// over-claims.
			});
		return () => {
			cancelled = true;
		};
	}, [tier]);

	const hasPlaygroundAccess = spectreAccess !== "none";

	// Every model is selectable once access exists: each is charged at its own API price, so
	// the tier ladder has no bearing on which one a customer can afford. Kafelot keeps its
	// ladder -- the two products are entitled differently on purpose.
	const allowedModels = useMemo<TextModelKey[]>(
		() => (hasPlaygroundAccess ? ALL_TEXT_MODEL_KEYS : []),
		[hasPlaygroundAccess],
	);


	// Start on the small model.
	//
	// The Playground used to start on the *last* model in the list, which is the
	// 8B A1B: a 4.9 GB file that takes minutes to load and needs the whole GPU.
	// The first thing a customer did was wait several minutes for a model they
	// had not chosen. The small model loads in seconds and answers first.
	useEffect(() => {
		if (allowedModels.length === 0) return;
		setModel((current) => {
			if (current && allowedModels.includes(current)) return current;
			return allowedModels.includes(TEXT_MODEL_230M) ? TEXT_MODEL_230M : allowedModels[0];
		});
	}, [allowedModels]);

	// The reply length is bounded by the model's own context window, so the
	// control can never offer a reply the model has nowhere to put.
	const maxTokensCeiling = useMemo(
		() => (model ? maxTokensCeilingFor(model) : MAX_TOKENS_LEVELS[0]),
		[model],
	);
	const contextTokens = model ? MODEL_CONTEXT_TOKENS[model] : 0;

	// The control's stops are the context levels, so the value is a position on
	// the ladder rather than a number of tokens.
	const levelIndex = useMemo(() => {
		const found = MAX_TOKENS_LEVELS.indexOf(maxTokens);
		return found >= 0 ? found : 0;
	}, [maxTokens]);
	const availableLevels = useMemo(
		() => MAX_TOKENS_LEVELS.filter((level) => level <= maxTokensCeiling),
		[maxTokensCeiling],
	);

	// Switching to a model with a smaller window has to pull the current value
	// back inside it, or the control would sit past its own end. It goes back to
	// the default rather than up to the new ceiling, because jumping to 16k
	// tokens because you changed model is not what anyone meant.
	useEffect(() => {
		if (!model || maxTokens <= maxTokensCeiling) return;
		setMaxTokens(defaultMaxTokensFor(model));
	}, [model, maxTokens, maxTokensCeiling]);

	// Thinking is MAX/ULTIMATE-only; never leave the toggle on for a lower plan.
	const thinkingAllowed = tier ? tierCanUseThinkingModel(tier) : false;
	useEffect(() => {
		if (!thinkingAllowed) setThinking(false);
	}, [thinkingAllowed]);

	// The model is loaded in the background as soon as it is picked, so the
	// first message does not pay for the load.
	//
	// Its state is not shown. The progress bar beside the model picker already
	// says what is happening, and a second indicator saying "warming up" only
	// confused people: it is not the conversation that is warming up, it is a
	// 4.9 GB file being read off the disk.
	useModelPrewarm({ modelKey: hasPlaygroundAccess ? model : null, enabled: hasPlaygroundAccess });
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
			const loaded = await waitUntilLoaded();
			if (!loaded.ok) {
				throw new Error(
					loaded.reason === "timeout"
						? `${MODEL_LABEL_BY_KEY[model]} is still loading. It is a large model and takes several minutes on this machine -- wait a moment and send again.`
						: `${MODEL_LABEL_BY_KEY[model]} could not be loaded${loaded.error ? `: ${loaded.error}` : ""}. Please try again.`,
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
					model,
					max_tokens: maxTokens,
					thinking,
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { message?: string } | null;
				// Out of allowance and wallet is not a request failure -- it is the meter
				// reading zero, and the useful thing to show is what the customer can do
				// about it rather than the status code.
				if (response.status === 402) {
					const gate = readBalanceGate(payload);
					setBalanceGate(gate);
					setMessages((prev) =>
						prev.map((m) =>
							m.id === assistantId
								? {
										...m,
										content: payload?.message || "You are out of AI usage for this month.",
										failed: true,
									}
								: m,
						),
					);
					return;
				}
				setBalanceGate(null);
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
	}, [input, streaming, model, maxTokens, thinking, nextId, waitUntilLoaded]);

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
					<PlaygroundModelLineup tier={tier ?? null} access={spectreAccess} textOnly />
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
						The Spectre Playground is a <strong>{ron(SPECTRE_SUBSCRIPTION.monthlyRon)} per month</strong>{" "}
						subscription, or {ron(SPECTRE_SUBSCRIPTION.annualRon)} a year. It is also included with the{" "}
						<strong> MAX</strong> and <strong>ULTIMATE</strong> plans.
					</p>
					<p className="playgate-note">
						Model usage is <strong>not</strong> included in the subscription. Every message is metered at the
						API list price shown in the lineup below and billed to your wallet.
					</p>
					<div className="playgate-actions">
						<Link className="playground-cta" href={buildPageHref("subscription")}>
							Subscribe
						</Link>
						<Link className="playground-cta playground-cta--ghost" href={buildPageHref("subscription")}>
							View plans
						</Link>
					</div>
					{upgradeMessage ? <p className="playground-upgrade-error">{upgradeMessage}</p> : null}
					{/* On the paywall the line-up *is* the argument, so it starts open. */}
					<PlaygroundModelLineup tier={tier ?? null} access={spectreAccess} textOnly defaultOpen />
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
					{model ? <ModelLoadingBar modelKey={model} state={modelLoad} compact /> : null}
					<DesktopAppDownload />
					{/* The source is open, so the link to it belongs on the page that
					    shows what it does. */}
					<a
						className="playground-icon-button"
						href={GITHUB_URL}
						target="_blank"
						rel="noopener noreferrer"
						title="Filspresso on GitHub"
						aria-label="Filspresso on GitHub"
					>
						<GithubIcon size={18} />
					</a>
				</div>
			</header>

			<section className="playground-controls" aria-label="Model settings">
				<div className="playground-model-column">
					<label className="playground-field playground-field-model">
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

					{/* The line-up is a submenu of the picker, not a table at the foot of
					    the page: the picker is what you use, and the prices are what you
					    open when you want to know what a message costs. */}
					<PlaygroundModelLineup tier={tier ?? null} access={spectreAccess} textOnly compact />
				</div>

				<div className="playground-field playground-field-tokens">
					<span>
						Max tokens <em>{formatContextTokens(maxTokens)}</em>{" "}
						{contextTokens > 0 ? (
							<small>of {formatContextTokens(contextTokens)} context</small>
						) : null}
					</span>
					{/* The stops are the context levels -- 16K, 32K, 64K, 128K -- so the
					    control says what it is and lands on a level rather than on an
					    arbitrary number of tokens. */}
					<input
						type="range"
						min={0}
						max={Math.max(0, availableLevels.length - 1)}
						step={1}
						value={Math.min(levelIndex, Math.max(0, availableLevels.length - 1))}
						disabled={streaming}
						onChange={(event) => {
							const next = availableLevels[Number.parseInt(event.target.value, 10)];
							if (next) setMaxTokens(next);
						}}
					/>
					<div className="playground-token-levels" aria-hidden="true">
						{availableLevels.map((level) => (
							<span key={level} data-active={level === maxTokens}>
								{formatContextTokens(level)}
							</span>
						))}
					</div>
				</div>

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

			{balanceGate ? <AiBalanceExhausted gate={balanceGate} /> : null}

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
		</main>
	);
}
