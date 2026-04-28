"use client";

import { useEffect, useMemo, useState } from "react";

export type ProgressiveLoadPhase = "idle" | "skeleton" | "progress" | "status";

export type ProgressiveLoadVariant = "app" | "coffee" | "machines";

type ProgressiveLoadState = {
	phase: ProgressiveLoadPhase;
	progress: number;
	statusMessage: string;
};

const statusMessages: Record<Exclude<ProgressiveLoadVariant, "app">, string[]> = {
	coffee: ["Optimizing images...", "Checking our latest stock...", "Scanning for the best deals on coffee..."],
	machines: ["Optimizing images...", "Checking our latest stock...", "Scanning for the best deals on machines..."],
};

const defaultStatusMessages = ["Warming up the showcase...", "Pulling the latest results...", "Just a moment longer..."];

export function useProgressiveLoadState(active: boolean, variant: ProgressiveLoadVariant, subjectLabel?: string) {
	const [elapsedMs, setElapsedMs] = useState(0);

	useEffect(() => {
		if (!active) {
			return;
		}

		const startedAt = Date.now();
		const timer = window.setInterval(() => {
			setElapsedMs(Date.now() - startedAt);
		}, 250);

		return () => {
			window.clearInterval(timer);
			setElapsedMs(0);
		};
	}, [active]);

	return useMemo<ProgressiveLoadState>(() => {
		if (!active) {
			return { phase: "idle", progress: 0, statusMessage: "" };
		}

		const phase: ProgressiveLoadPhase =
			elapsedMs < 1000 ? "idle" : elapsedMs < 3000 ? "skeleton" : elapsedMs < 10000 ? "progress" : "status";
		const progress =
			phase === "progress"
				? Math.min(92, 15 + ((elapsedMs - 3000) / 7000) * 77)
				: phase === "status"
					? Math.min(97, 88 + ((elapsedMs - 10000) / 10000) * 9)
					: 0;
		const messages = variant === "app" ? defaultStatusMessages : statusMessages[variant];
		const safeSubjectLabel = subjectLabel?.trim();
		const messageIndex = Math.min(messages.length - 1, Math.floor(Math.max(0, elapsedMs - 10000) / 2500));
		const baseMessage = messages[messageIndex] || defaultStatusMessages[defaultStatusMessages.length - 1];
		const statusMessage =
			phase === "status" && safeSubjectLabel
				? baseMessage.replace(/coffee|machines|showcase/gi, safeSubjectLabel)
				: baseMessage;

		return { phase, progress, statusMessage };
	}, [active, elapsedMs, subjectLabel, variant]);
}