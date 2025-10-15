"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

type MachineNotification = {
	id: string;
	message: string;
	duration: number;
	ts: number;
	variant?: "info" | "success" | "error";
	remaining: number;
	isPaused: boolean;
};

type MachineContextType = {
	notify: (message: string, duration?: number, variant?: MachineNotification["variant"]) => string;
	dismiss: (id: string) => void;
};

const MachineNotificationsContext = createContext<MachineContextType | null>(null);

export function useMachineNotifications() {
	const ctx = useContext(MachineNotificationsContext);
	if (!ctx) throw new Error("useMachineNotifications must be used within MachineNotificationsProvider");
	return ctx;
}

export default function MachineNotificationsProvider({ children }: { children: React.ReactNode }) {
	const [items, setItems] = useState<MachineNotification[]>([]);
	const timersRef = useRef<Map<string, { timeout: ReturnType<typeof setTimeout>; start: number }>>(new Map());

	const clearTimer = useCallback((id: string) => {
		const active = timersRef.current.get(id);
		if (active) {
			clearTimeout(active.timeout);
			timersRef.current.delete(id);
		}
	}, []);

	const dismiss = useCallback(
		(id: string) => {
			clearTimer(id);
			setItems((s) => s.filter((it) => it.id !== id));
		},
		[clearTimer]
	);

	const notify = useCallback((message: string, duration = 6000, variant: MachineNotification["variant"] = "info") => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const ts = Date.now();
		setItems((s) => [...s, { id, message, duration, ts, variant, remaining: duration, isPaused: false }]);
		return id;
	}, []);

	useEffect(() => {
		items.forEach((n) => {
			if (n.isPaused) {
				clearTimer(n.id);
				return;
			}
			if (n.remaining <= 0) {
				dismiss(n.id);
				return;
			}
			if (!timersRef.current.has(n.id)) {
				const timeout = setTimeout(() => {
					timersRef.current.delete(n.id);
					dismiss(n.id);
				}, n.remaining);
				timersRef.current.set(n.id, { timeout, start: Date.now() });
			}
		});
		// cleanup any timers that no longer have notifications
		timersRef.current.forEach((_, id) => {
			if (!items.some((n) => n.id === id)) {
				clearTimer(id);
			}
		});
	}, [items, dismiss, clearTimer]);

	// clear machine notifications when route changes
	const pathname = usePathname();
	useEffect(() => {
		if (!pathname) return;
		timersRef.current.forEach((v) => clearTimeout(v.timeout));
		timersRef.current.clear();
		setItems([]);
	}, [pathname]);

	const pause = useCallback(
		(id: string) => {
			let shouldDismiss = false;
			setItems((prev) =>
				prev.map((n) => {
					if (n.id !== id || n.isPaused) return n;
					const active = timersRef.current.get(id);
					if (!active) return { ...n, isPaused: true };
					const elapsed = Date.now() - active.start;
					const remaining = Math.max(n.remaining - elapsed, 0);
					clearTimer(id);
					if (remaining <= 0) {
						shouldDismiss = true;
						return { ...n, remaining: 0, isPaused: true };
					}
					return { ...n, remaining, isPaused: true };
				})
			);
			if (shouldDismiss) dismiss(id);
		},
		[dismiss, clearTimer]
	);

	const resume = useCallback(
		(id: string) => {
			let shouldDismiss = false;
			setItems((prev) =>
				prev.map((n) => {
					if (n.id !== id || !n.isPaused) return n;
					if (n.remaining <= 0) {
						shouldDismiss = true;
						return n;
					}
					return { ...n, isPaused: false };
				})
			);
			if (shouldDismiss) dismiss(id);
		},
		[dismiss]
	);

	const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

	// stacking params (match app provider wallet-style fan)
	// Always use the compact wallet-style fan regardless of count (user request).
	const compact = true;
	const maxStack = 5;
	const translateStep = compact ? 18 : 8;
	const opacityStep = compact ? 0.12 : 0.04;
	const baseZ = 3000;

	const renderIcon = useCallback(() => {
		return (
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="notif-icon">
				<path d="M12 2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M5 7h14v10H5z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M9 21h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}, []);

	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const node = (
		<div className={`notifications-root machine-only ${compact ? "compact" : ""}`} aria-live="polite" aria-atomic="true">
			{items.map((n, idx) => {
				const distanceFromLatest = items.length - 1 - idx;
				const capped = Math.min(distanceFromLatest, maxStack - 1);

				const animationDelay = `${idx * 70}ms`;

				let stackingStyle: React.CSSProperties;
				if (distanceFromLatest >= maxStack) {
					const overflowIndex = distanceFromLatest - maxStack;
					const translateY = -(maxStack * translateStep) - overflowIndex * (translateStep + 8);
					const translateX = 0;
					const scale = 1;
					const opacity = Math.max(0.92 - overflowIndex * 0.04, 0.6);
					const boxShadow = `0 ${10 + overflowIndex * 2}px ${22 + overflowIndex * 6}px rgba(6,6,6,0.12)`;
					const zIndex = baseZ + maxStack + 100 + overflowIndex;

					stackingStyle = {
						transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
						opacity,
						boxShadow,
						zIndex,
						animationDelay,
						transformOrigin: "right bottom",
					};
				} else {
					const translateY = capped * translateStep; // positive -> move lower
					const translateX = 0;
					const scale = 1;
					const opacity = Math.max(1 - capped * (opacityStep * 0.6), 0.78);

					const depthFactor = Math.max(0, maxStack - capped);
					const shadowOffsetY = 8 + depthFactor * 2;
					const shadowBlur = 18 + depthFactor * 6;
					const shadowAlpha = Math.min(0.6, 0.1 + depthFactor * 0.05);
					const boxShadow = `0 ${shadowOffsetY}px ${shadowBlur}px rgba(6,6,6,${shadowAlpha})`;
					const zIndex = baseZ + (maxStack - capped);

					stackingStyle = {
						transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
						opacity,
						boxShadow,
						zIndex,
						animationDelay,
						transformOrigin: "right bottom",
					} as React.CSSProperties;
				}

				const icon = renderIcon();

				const handleProgressEnd = () => {
					dismiss(n.id);
				};

				const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
					const activeElement = typeof document !== "undefined" ? document.activeElement : null;
					if (activeElement && event.currentTarget.contains(activeElement)) return;
					resume(n.id);
				};

				const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
					const nextFocus = (event.relatedTarget as Node | null) ?? null;
					if (nextFocus && event.currentTarget.contains(nextFocus)) return;
					if (event.currentTarget.matches(":hover")) return;
					resume(n.id);
				};

				return (
					<div
						key={n.id}
						className={`notification-card ${n.variant ?? "info"} machine-only`}
						role="status"
						data-paused={n.isPaused ? "true" : "false"}
						style={stackingStyle as React.CSSProperties}
						onPointerEnter={() => pause(n.id)}
						onPointerLeave={handlePointerLeave}
						onFocusCapture={() => pause(n.id)}
						onBlurCapture={handleBlur}
					>
						<div className="notif-row">
							<div className="notif-icon-wrap" aria-hidden>
								{icon}
							</div>
							<div className="notif-body">
								<div className="notif-message">{n.message}</div>
							</div>
						</div>
						<div
							className="notif-progress"
							style={{ animationDuration: `${n.duration}ms` }}
							aria-hidden
							onAnimationEnd={handleProgressEnd}
						/>
					</div>
				);
			})}
		</div>
	);

	return (
		<MachineNotificationsContext.Provider value={value}>
			{children}
			{mounted && typeof document !== "undefined" ? createPortal(node, document.body) : null}
		</MachineNotificationsContext.Provider>
	);
}
