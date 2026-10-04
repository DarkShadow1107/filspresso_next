"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isSignedIn, subscribeAuthState } from "@/lib/authState";

export type PrewarmStatus = "idle" | "warming" | "ready" | "unavailable" | "forbidden" | "unreachable";

export type PrewarmState = {
	status: PrewarmStatus;
	label: string;
	durationMs: number | null;
};

const IDLE: PrewarmState = { status: "idle", label: "", durationMs: null };

const LABEL_BY_STATUS: Record<Exclude<PrewarmStatus, "idle">, string> = {
	warming: "Warming up…",
	ready: "Ready",
	unavailable: "Unavailable",
	forbidden: "Locked",
	unreachable: "AI offline",
};

/** ~2.9s measured for a cold LFM2-VL load on this host, so a few polls cover
 *  the realistic range while still bounding a wedged loader. */
const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 30;
const MAX_TRANSPORT_RETRIES = 3;
const DEBOUNCE_MS = 400;

/**
 * Keeps the selected Kafelot model resident in its llama.cpp slot.
 *
 * llama.cpp loads a model on its first request, so the first prompt after an
 * idle period pays a multi-second cold load. Warming when the popup opens and
 * whenever the selected model changes moves that cost off the user's first
 * message.
 *
 * Rapid model switching is debounced so it does not queue a load per click, and
 * polling stops as soon as a load settles. Model and tier authorization happens
 * entirely server-side in /api/playground/prewarm; this hook never decides what
 * the caller is allowed to load.
 */

type UseModelPrewarmOptions = {
	/** Model key the popup will actually use, or null when nothing is selected. */
	modelKey: string | null;
	/** Only warm while the popup is on screen. */
	enabled: boolean;
};

type WarmupPayload = { status?: string; duration_ms?: number | null };

export function useModelPrewarm({ modelKey, enabled }: UseModelPrewarmOptions) {
	const [state, setState] = useState<PrewarmState>(IDLE);

	const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// The model key the current warm belongs to; cleared once it settles so a
	// late response from an abandoned load cannot overwrite newer state.
	const warmedRef = useRef<string | null>(null);

	const isLoggedIn = useSyncExternalStore(subscribeAuthState, isSignedIn, () => false);

	const clearTimers = useCallback(() => {
		if (pollTimerRef.current) {
			clearTimeout(pollTimerRef.current);
			pollTimerRef.current = null;
		}
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
	}, []);

	useEffect(() => clearTimers, [clearTimers]);

	const settle = useCallback((key: string, next: PrewarmState) => {
		if (warmedRef.current !== key) return;
		warmedRef.current = null;
		setState(next);
	}, []);

	const poll = useCallback(
		(key: string) => {
			const step = async (attempt: number): Promise<void> => {
				if (warmedRef.current !== key) return;

				try {
					const res = await fetch(`/api/playground/prewarm?model=${encodeURIComponent(key)}`, {
						cache: "no-store",
					});
					const data = (await res.json()) as WarmupPayload;
					if (warmedRef.current !== key) return;

					const raw = (data.status || "").toLowerCase();
					if (raw === "ready") {
						settle(key, { status: "ready", label: LABEL_BY_STATUS.ready, durationMs: data.duration_ms ?? null });
						return;
					}
					if (raw === "unavailable" || raw === "forbidden") {
						settle(key, { status: raw, label: LABEL_BY_STATUS[raw], durationMs: null });
						return;
					}
				if (raw === "unauthorized") {
					settle(key, IDLE);
					return;
				}
				// Deferred: the model's slot was busy with real traffic. Settle
				// quietly instead of burning the remaining polls on a load that
				// is not going to start.
				if (raw === "deferred" || raw === "idle") {
					settle(key, IDLE);
					return;
				}
					if (attempt >= MAX_POLLS) {
						settle(key, { status: "unreachable", label: LABEL_BY_STATUS.unreachable, durationMs: null });
						return;
					}
					pollTimerRef.current = setTimeout(() => void step(attempt + 1), POLL_INTERVAL_MS);
				} catch {
					if (warmedRef.current !== key) return;
					if (attempt >= MAX_TRANSPORT_RETRIES) {
						settle(key, { status: "unreachable", label: LABEL_BY_STATUS.unreachable, durationMs: null });
						return;
					}
					pollTimerRef.current = setTimeout(() => void step(attempt + 1), POLL_INTERVAL_MS * 2);
				}
			};

			void step(0);
		},
		[settle],
	);

	const warm = useCallback(
		(key: string) => {
			clearTimers();
			warmedRef.current = key;
			// Reachable only from the debounce timer, so this is not a
			// synchronous state update during render.
			setState({ status: "warming", label: LABEL_BY_STATUS.warming, durationMs: null });

			void (async () => {
				try {
					const res = await fetch("/api/playground/prewarm", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ model: key }),
					});
					const data = (await res.json()) as WarmupPayload;
					if (warmedRef.current !== key) return;

				const raw = (data.status || "").toLowerCase();
				// A model that is already resident answers `ready` immediately.
				if (raw === "ready") {
					settle(key, { status: "ready", label: LABEL_BY_STATUS.ready, durationMs: data.duration_ms ?? null });
					return;
				}
				if (raw === "unavailable" || raw === "forbidden") {
					settle(key, { status: raw, label: LABEL_BY_STATUS[raw], durationMs: null });
					return;
				}
				// Deferred: real traffic is holding the model's only slot, so the
				// pre-warm yielded rather than stealing it. Not an error and not
				// worth polling for -- stop here and let the next attempt retry.
				if (raw === "deferred" || raw === "idle") {
					settle(key, IDLE);
					return;
				}
				if (raw === "unauthorized" || raw === "rejected") {
					settle(key, IDLE);
					return;
				}

					poll(key);
				} catch {
					settle(key, { status: "unreachable", label: LABEL_BY_STATUS.unreachable, durationMs: null });
				}
			})();
		},
		[clearTimers, poll, settle],
	);

	const shouldWarm = Boolean(enabled && modelKey && isLoggedIn);

	useEffect(() => {
		if (!shouldWarm || !modelKey) {
			// Nothing to warm: drop any pending timers and forget the target. The
			// idle presentation is derived below rather than set here.
			warmedRef.current = null;
			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
			return;
		}

		debounceTimerRef.current = setTimeout(() => warm(modelKey), DEBOUNCE_MS);

		return () => {
			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
			warmedRef.current = null;
		};
	}, [shouldWarm, modelKey, warm]);

	return shouldWarm ? state : IDLE;
}