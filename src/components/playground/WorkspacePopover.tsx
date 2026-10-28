"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** A small portal menu, always fitted below the fixed site navigation. */
export default function WorkspacePopover({ anchor, onClose, label, children, className = "", width = 240 }: {
	anchor: RefObject<HTMLButtonElement | null>;
	onClose: () => void;
	label: string;
	children: ReactNode;
	className?: string;
	width?: number;
}) {
	const panel = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 320, width, visibility: "hidden" as "hidden" | "visible" });
	useLayoutEffect(() => {
		const place = () => {
			const rect = anchor.current?.getBoundingClientRect();
			if (!rect || !panel.current) return;
			const navBottom = document.querySelector(".header_body")?.getBoundingClientRect().bottom ?? 0;
			const minTop = Math.max(8, navBottom + 8);
			const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
			const bottom = viewportHeight - 8;
			if (rect.bottom <= minTop || rect.top >= bottom) { onClose(); return; }
			const above = Math.max(0, rect.top - minTop - 8);
			const below = Math.max(0, bottom - rect.bottom - 8);
			const height = panel.current.scrollHeight;
			const useAbove = above >= Math.min(height, 320) || above > below;
			const maxHeight = Math.max(40, useAbove ? above : below);
			const menuWidth = Math.min(width, window.innerWidth - 16);
			setPosition({ top: useAbove ? Math.max(minTop, rect.top - Math.min(height, maxHeight) - 8) : Math.max(minTop, rect.bottom + 8),
				left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)), maxHeight, width: menuWidth, visibility: "visible" });
		};
		place();
		const escape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault(); onClose(); anchor.current?.focus({ preventScroll: true });
		};
		const outside = (event: PointerEvent) => {
			if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onClose();
		};
		const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
		document.addEventListener("pointerdown", outside);
		document.addEventListener("keydown", escape);
		window.addEventListener("resize", place);
		window.addEventListener("scroll", scroll, true);
		return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("resize", place); window.removeEventListener("scroll", scroll, true); };
	}, [anchor, onClose, width]);
	useLayoutEffect(() => {
		if (position.visibility === "visible") panel.current?.querySelector<HTMLElement>("[aria-checked=true], [role=menuitem], select, button")?.focus({ preventScroll: true });
	}, [position.visibility]);
	return createPortal(<div ref={panel} className={`pgw-floating-panel ${className}`} style={position} role="menu" aria-label={label} onKeyDown={event => {
		if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); anchor.current?.focus({ preventScroll: true }); }
		if (event.key === "Tab") onClose();
		if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
			event.preventDefault();
			const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select") || []);
			const index = items.indexOf(document.activeElement as HTMLElement);
			items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
		}
	}}>{children}</div>, document.body);
}
