"use client";

import { MODEL_LABEL_BY_KEY, type ModelKey } from "@/lib/modelAccess";
import type { ModelLoadState } from "@/hooks/useModelLoadStatus";

type ModelLoadingBarProps = {
	modelKey: ModelKey;
	state: ModelLoadState;
	/** Compact form for inline use next to a model chip. */
	compact?: boolean;
};

/**
 * Determinate progress bar shown while a model is being swapped onto the GPU.
 *
 * Only one chat model is resident at a time, so this is not a rare edge case: any
 * model change triggers a swap. The percentage comes from elapsed time against the
 * *measured* duration of that model's last load (the gateway caps it at 95 so it
 * never claims completion before the runtime agrees), which is honest about being
 * an estimate rather than pretending to know byte-level progress.
 */
export default function ModelLoadingBar({ modelKey, state, compact = false }: ModelLoadingBarProps) {
	if (state.status === "loaded") return null;

	const label = MODEL_LABEL_BY_KEY[modelKey] ?? modelKey;
	const progress = Math.max(0, Math.min(100, state.progress ?? 0));
	const isError = state.status === "unavailable";

	if (isError) {
		return (
			<div className={`model-load-bar${compact ? " compact" : ""} error`} role="status">
				<span className="model-load-label">
					{state.error || `${label} could not be loaded.`}
				</span>
			</div>
		);
	}

	if (state.status !== "loading") return null;

	const elapsed = state.elapsedSeconds ? Math.round(state.elapsedSeconds) : 0;
	const estimate = state.estimatedSeconds ? Math.round(state.estimatedSeconds) : 0;

	return (
		<div
			className={`model-load-bar${compact ? " compact" : ""}`}
			role="progressbar"
			aria-valuenow={progress}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-label={`Loading ${label}`}
		>
			<div className="model-load-track">
				<div className="model-load-fill" style={{ width: `${progress}%` }} />
			</div>
			<span className="model-load-label">
				{/* The same word llama.cpp's own web UI uses, so the wait reads the
				    way the rest of the tool does. */}
				Warming up… {label}
				{compact ? "" : estimate > 0 ? ` · about ${estimate}s` : ""}
				{elapsed > 0 ? ` · ${elapsed}s elapsed` : ""}
				<span className="model-load-pct">{progress}%</span>
			</span>
		</div>
	);
}
