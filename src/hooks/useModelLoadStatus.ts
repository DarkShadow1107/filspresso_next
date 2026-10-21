"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MODEL_FILE_BY_KEY, type ModelKey } from "@/lib/modelAccess";

export type ModelLoadStatus = "loaded" | "loading" | "not_loaded" | "unavailable";

export type ModelLoadState = {
	status: ModelLoadStatus;
	/** 0-100, derived from elapsed time against the measured load duration. */
	progress: number;
	elapsedSeconds?: number;
	estimatedSeconds?: number;
	error?: string;
};

const IDLE: ModelLoadState = { status: "not_loaded", progress: 0 };

/** How often to poll while a model is loading. */
const POLL_MS = 1000;

/**
 * How long to wait for a model to become resident.
 *
 * The AI service allows a load 15 minutes (AI_LOAD_DEADLINE_SECONDS), because the
 * 8B A1B is a 4.9 GB file that is read from disk and takes minutes. This waits a
 * little longer than that, so the browser is never the one to give up while the
 * server is still legitimately loading.
 *
 * It used to be 3 minutes, which is what produced "LFM 2.5 230M could not be
 * loaded in time": the small model was queued behind a big model that was still
 * loading, and the browser gave up seconds before the server finished.
 */
const LOAD_WAIT_MS = 16 * 60 * 1000;

/** Give up after this long so a wedged load cannot poll forever. */
const MAX_POLL_MS = LOAD_WAIT_MS;

/** How a wait for a model ended. */
export type ModelLoadOutcome =
	| { ok: true }
	| { ok: false; reason: "unavailable" | "timeout"; error?: string };


/**
 * Tracks whether a model is loaded, and asks for it to be loaded if not.
 *
 * Only one chat model is resident at a time (the llama.cpp router runs with
 * --models-max 1), so switching models means a swap: seconds for the small models
 * and minutes for the 8B A1B. The hook surfaces that as progress so the UI can show
 * a determinate bar instead of an indefinite spinner.
 *
 * Polling uses an interval owned by the effect rather than a chained timeout: a
 * self-referencing `setTimeout(() => poll())` inside a `useCallback` is a hooks
 * violation, and an interval also means exactly one timer per selected model.
 */
export function useModelLoadStatus(modelKey: ModelKey | null | undefined) {
	const [state, setState] = useState<ModelLoadState>(IDLE);
	const startedRef = useRef<number>(0);
	const loadingRef = useRef(false);
	const file = modelKey ? MODEL_FILE_BY_KEY[modelKey] : "";

	const poll = useCallback(async () => {
		// No model selected: nothing to fetch, and nothing to record. The idle state
		// is derived at the bottom of the hook rather than stored, so there is no
		// synchronous setState on this path.
		if (!file) return;

		try {
			const response = await fetch(
				`/api/model-status?model=${encodeURIComponent(file)}`,
				{ cache: "no-store" },
			);
			if (!response.ok) throw new Error(`status ${response.status}`);
			const data = (await response.json()) as {
				status?: string;
				progress?: number;
				elapsed_seconds?: number;
				estimated_seconds?: number;
				error?: string;
			};

			const status = (data.status as ModelLoadStatus) ?? "not_loaded";
			const timedOut = status === "loading" && Date.now() - startedRef.current > MAX_POLL_MS;

			loadingRef.current = status === "loading" && !timedOut;
			setState(
				timedOut
					? { status: "unavailable", progress: 0, error: "Timed out waiting for the model to load." }
					: {
							status,
							progress: typeof data.progress === "number" ? data.progress : 0,
							elapsedSeconds: data.elapsed_seconds,
							estimatedSeconds: data.estimated_seconds,
							error: data.error,
						},
			);
		} catch {
			loadingRef.current = false;
			setState((prev) =>
				prev.status === "loading"
					? { ...prev, error: "Lost contact with the AI runtime." }
					: { status: "unavailable", progress: 0, error: "Could not read model status." },
			);
		}
	}, [file]);

	/** Ask for the model to be loaded. Resolves immediately; poll for progress. */
	const ensureLoaded = useCallback(async () => {
		if (!file) return;
		startedRef.current = Date.now();
		loadingRef.current = true;
		setState((prev) => (prev.status === "loading" ? prev : { status: "loading", progress: 0 }));
		try {
			await fetch(`/api/model-status?load=${encodeURIComponent(file)}`, { cache: "no-store" });
		} catch {
			// The poll below reports the failure; nothing to do here.
		}
		void poll();
	}, [file, poll]);

	/**
	 * Ensure the model is resident and wait for it.
	 *
	 * `ensureLoaded` only *starts* the swap, which is right for a background
	 * prewarm but wrong before sending: the gateway would otherwise wait out
	 * `AI_QUEUE_WAIT_SECONDS` and answer 429. Callers should await this so the
	 * progress bar the user is already watching is what gates the request.
	 *
	 * Polls the status endpoint directly rather than reading React state, so it
	 * stays correct when called from a handler that captured an older render.
	 *
	 * The result says *why* it ended, because the two failures need different
	 * words: the server giving up on a model it could not load is a failure the
	 * user can retry, while the deadline here expiring means the model is still
	 * loading and the answer is to wait, not to give up.
	 */
	const waitUntilLoaded = useCallback(
		async (timeoutMs = LOAD_WAIT_MS, signal?: AbortSignal): Promise<ModelLoadOutcome> => {
			signal?.throwIfAborted();
			if (!file) return { ok: true };
			await ensureLoaded();
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				signal?.throwIfAborted();
				try {
					const res = await fetch(
						`/api/model-status?model=${encodeURIComponent(file)}`,
						{ cache: "no-store", signal },
					);
					if (res.ok) {
						const data = (await res.json()) as { status?: string; error?: string };
						if (data.status === "loaded") return { ok: true };
						// The gateway answered but will not serve this model, so waiting
						// longer cannot help.
						if (data.status === "unavailable") {
							return { ok: false, reason: "unavailable", error: data.error };
						}
					}
				} catch {
					signal?.throwIfAborted();
					// Transient network error; the deadline still bounds this loop.
				}
				await new Promise((resolve) => setTimeout(resolve, POLL_MS));
			}
			return { ok: false, reason: "timeout" };
		},
		[file, ensureLoaded],
	);

	/* eslint-disable react-hooks/set-state-in-effect --
	 * poll() only calls setState after an `await`, so these are not synchronous
	 * updates during commit. The rule does not track setState through an async
	 * callback, and polling a model-residency endpoint is precisely what this hook
	 * exists for. The alternative -- a bare setTimeout loop outside React -- would
	 * be worse, not better. */
	useEffect(() => {
		startedRef.current = Date.now();
		void poll();
		const interval = setInterval(() => {
			if (loadingRef.current) void poll();
		}, POLL_MS);
		return () => clearInterval(interval);
	}, [file, poll]);
	/* eslint-enable react-hooks/set-state-in-effect */

	// With no model selected there is nothing to report, so the idle state is
	// derived rather than pushed through setState.
	const effective: ModelLoadState = file ? state : IDLE;

	return {
		...effective,
		isLoading: effective.status === "loading",
		isLoaded: effective.status === "loaded",
		ensureLoaded,
		waitUntilLoaded,
	};
}
