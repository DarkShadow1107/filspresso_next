"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import {
	CoffeeIcon,
	CreditCard,
	InfoCircleIcon,
	SimpleCheckedIcon,
	TriangleAlertIcon,
	UserCheckIcon,
	RosetteDiscountIcon,
	ShoppingCartIcon,
	WashingMachineIcon,
} from "@/icons";

type Notification = {
	id: string;
	message: string;
	duration: number;
	ts: number;
	variant?: "info" | "success" | "error";
	category?: string;
	actions?: NotificationAction[];
	persist?: boolean;
	remaining: number;
	isPaused: boolean;
	originPath?: string;
};

type NotificationAction = {
	id: string;
	label: string;
	variant?: "primary" | "ghost";
	onClick?: () => void;
};

type NotificationExtras = {
	actions?: NotificationAction[];
	persist?: boolean;
};

type ContextType = {
	notify: (
		message: string,
		duration?: number,
		variant?: Notification["variant"],
		category?: string,
		extras?: NotificationExtras,
	) => string;
	dismiss: (id: string) => void;
};

const NotificationsContext = createContext<ContextType | null>(null);

export function useNotifications() {
	const ctx = useContext(NotificationsContext);
	if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
	return ctx;
}

export default function NotificationsProvider({ children }: { children: React.ReactNode }) {
	const [notifications, setNotifications] = useState<Notification[]>([]);
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
			setNotifications((s) => s.filter((notification) => notification.id !== id));
		},
		[clearTimer],
	);

	const pathname = usePathname();
	const searchParams = useSearchParams();
	const routeKey = useMemo(() => {
		const sp = searchParams ? searchParams.toString() : "";
		return sp ? `${pathname}?${sp}` : pathname;
	}, [pathname, searchParams]);
	const scopedCategories = useMemo(() => new Set(["coffee", "account", "subscription", "bag", "payment"]), []);

	const notify = useCallback(
		(
			message: string,
			duration = 6000,
			variant: Notification["variant"] = "info",
			category = "generic",
			extras: NotificationExtras = {},
		) => {
			const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
			const ts = Date.now();
			const originPath =
				routeKey ?? (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/");
			setNotifications((s) => [
				...s,
				{
					id,
					message,
					duration,
					ts,
					variant,
					category,
					actions: extras.actions,
					persist: extras.persist ?? false,
					remaining: duration,
					isPaused: false,
					originPath,
				},
			]);
			return id;
		},
		[routeKey],
	);

	useEffect(() => {
		notifications.forEach((notification) => {
			if (notification.persist) {
				clearTimer(notification.id);
				return;
			}
			if (notification.remaining <= 0) {
				dismiss(notification.id);
				return;
			}
			if (notification.isPaused) {
				clearTimer(notification.id);
				return;
			}
			if (!timersRef.current.has(notification.id)) {
				const timeout = setTimeout(() => {
					timersRef.current.delete(notification.id);
					dismiss(notification.id);
				}, notification.remaining);
				timersRef.current.set(notification.id, { timeout, start: Date.now() });
			}
		});
		timersRef.current.forEach((_, id) => {
			if (!notifications.some((notification) => notification.id === id)) {
				clearTimer(id);
			}
		});
	}, [notifications, dismiss, clearTimer]);

	const pauseNotification = useCallback(
		(id: string) => {
			let shouldDismiss = false;
			setNotifications((prev) =>
				prev.map((notification) => {
					if (notification.id !== id || notification.persist || notification.isPaused) {
						return notification;
					}
					const active = timersRef.current.get(id);
					if (!active) {
						return { ...notification, isPaused: true };
					}
					const elapsed = Date.now() - active.start;
					const remaining = Math.max(notification.remaining - elapsed, 0);
					clearTimer(id);
					if (remaining <= 0) {
						shouldDismiss = true;
						return { ...notification, remaining: 0, isPaused: true };
					}
					return { ...notification, remaining, isPaused: true };
				}),
			);
			if (shouldDismiss) {
				dismiss(id);
			}
		},
		[clearTimer, dismiss],
	);

	const resumeNotification = useCallback(
		(id: string) => {
			let shouldDismiss = false;
			setNotifications((prev) =>
				prev.map((notification) => {
					if (notification.id !== id || notification.persist || !notification.isPaused) {
						return notification;
					}
					if (notification.remaining <= 0) {
						shouldDismiss = true;
						return notification;
					}
					return { ...notification, isPaused: false };
				}),
			);
			if (shouldDismiss) {
				dismiss(id);
			}
		},
		[dismiss],
	);

	const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

	// ensure we only portal after client mount to avoid SSR mismatches
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		const frame = window.requestAnimationFrame(() => setMounted(true));
		return () => window.cancelAnimationFrame(frame);
	}, []);

	// When the route changes, remove notifications that were created on other pages
	useEffect(() => {
		if (!routeKey) return;
		setNotifications((prev) => {
			const kept: Notification[] = [];
			prev.forEach((n) => {
				if (n.originPath && scopedCategories.has(n.category ?? "")) {
					if (n.originPath === routeKey) {
						kept.push(n);
					} else {
						const active = timersRef.current.get(n.id);
						if (active) {
							clearTimeout(active.timeout);
							timersRef.current.delete(n.id);
						}
					}
				} else {
					kept.push(n);
				}
			});
			return kept;
		});
	}, [routeKey, scopedCategories]);

	// Improved stacking: compute transform/scale/opacity per notification dynamically
	// so the stack looks like cards sitting behind each other. When there are
	// more than a few notifications we switch to a compact mode and increase
	// the layering effect. Newer notifications will receive a larger z-index
	// so they appear visually on top.
	// Always use the compact wallet-style fan regardless of count (user request).
	const compact = true;
	const maxStack = 5; // visually separate up to this many layers
	const translateStep = compact ? 18 : 8; // px per layer (vertical offset)
	const opacityStep = compact ? 0.12 : 0.04; // opacity reduction per older layer
	const baseZ = 3000; // base z-index for the notification stack
	const renderIcon = useCallback((notification: Notification) => {
		const category = notification.category;
		if (category === "coffee") {
			return <CoffeeIcon size={18} className="notif-icon" />;
		}
		if (category === "machine") {
			return <WashingMachineIcon size={18} className="notif-icon" />;
		}
		if (category === "subscription") {
			return <RosetteDiscountIcon size={18} className="notif-icon" />;
		}
		if (category === "account") {
			return <UserCheckIcon size={18} className="notif-icon" />;
		}
		if (category === "bag") {
			return <ShoppingCartIcon size={18} className="notif-icon" />;
		}
		if (category === "payment") {
			return <CreditCard size={18} className="notif-icon" />;
		}
		if (notification.variant === "success") {
			return <SimpleCheckedIcon size={18} className="notif-icon" />;
		}
		if (notification.variant === "error") {
			return <TriangleAlertIcon size={18} className="notif-icon" />;
		}
		return <InfoCircleIcon size={18} className="notif-icon" />;
	}, []);

	const notificationsNode = (
		<div className={`notifications-root ${compact ? "compact" : ""}`} aria-live="polite" aria-atomic="true">
			{notifications.map((n, idx) => {
				const icon = renderIcon(n);
				// distanceFromLatest: 0 = newest, larger = older
				const distanceFromLatest = notifications.length - 1 - idx;
				const capped = Math.min(distanceFromLatest, maxStack - 1);

				// If the notification is older than the visible stack (overflow),
				// render it above the stacked group so it is not behind anything.
				const animationDelay = `${idx * 70}ms`;
				let stackingStyle: React.CSSProperties;
				if (distanceFromLatest >= maxStack) {
					const overflowIndex = distanceFromLatest - maxStack; // 0-based
					// place above the stack: move upward (negative translateY) and add spacing
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
					// Straight stacked group for the newest `maxStack` items
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
				const hasActions = Boolean(n.actions?.length);
				const handleActionClick = (action: NotificationAction) => {
					if (action.onClick) {
						action.onClick();
					}
					dismiss(n.id);
				};
				const handleProgressEnd = () => {
					if (!n.persist) {
						dismiss(n.id);
					}
				};
				const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
					const activeElement = typeof document !== "undefined" ? document.activeElement : null;
					if (activeElement && event.currentTarget.contains(activeElement)) {
						return;
					}
					resumeNotification(n.id);
				};
				const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
					const nextFocus = (event.relatedTarget as Node | null) ?? null;
					if (nextFocus && event.currentTarget.contains(nextFocus)) {
						return;
					}
					if (event.currentTarget.matches(":hover")) {
						return;
					}
					resumeNotification(n.id);
				};
				return (
					<div
						key={n.id}
						className={`notification-card ${n.variant ?? "info"} ${n.category ?? "generic"}`}
						role="status"
						data-persist={n.persist ? "true" : "false"}
						data-paused={n.isPaused ? "true" : "false"}
						style={stackingStyle}
						onPointerEnter={() => pauseNotification(n.id)}
						onPointerLeave={handlePointerLeave}
						onFocusCapture={() => pauseNotification(n.id)}
						onBlurCapture={handleBlur}
					>
						<div className="notif-row">
							<div className="notif-icon-wrap" aria-hidden>
								{icon}
							</div>
							<div className="notif-body">
								<div className="notif-message">{n.message}</div>
								{hasActions ? (
									<div className="notif-actions">
										{n.actions?.map((action) => (
											<button
												key={action.id}
												type="button"
												className={`notif-action ${action.variant ?? "ghost"}`}
												onClick={() => handleActionClick(action)}
											>
												{action.label}
											</button>
										))}
									</div>
								) : null}
							</div>
						</div>
						{!n.persist ? (
							<div
								className="notif-progress"
								style={{ animationDuration: `${n.duration}ms` }}
								aria-hidden
								onAnimationEnd={handleProgressEnd}
							/>
						) : null}
					</div>
				);
			})}
		</div>
	);

	return (
		<NotificationsContext.Provider value={value}>
			{children}
			{mounted && typeof document !== "undefined" ? createPortal(notificationsNode, document.body) : null}
		</NotificationsContext.Provider>
	);
}
