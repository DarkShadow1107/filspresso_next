"use client";

import { useCallback, useEffect, useState } from "react";
import { useNotifications } from "@/components/NotificationsProvider";
import { useRouter } from "next/navigation";
import { buildPageHref } from "@/lib/pages";

const MY_ITEMS = "myItems";
const PASSED = "passedValue";
const CURRENT = "currentSum";
const IS_CLICKED = "is_clicked";

export type CartItem = {
	id: string;
	name: string;
	price: number;
	qty: number;
	image?: string;
};

function extractAndConvertFloat(data: string): number {
	const match = data.match(/\d+(?:[.,]\d+)?/);
	if (!match) return 0;
	return parseFloat(match[0].replace(",", "."));
}

function normaliseEntry(entry: unknown): CartItem | null {
	if (!entry) return null;

	if (typeof entry === "string") {
		const trimmed = entry.trim();
		if (!trimmed) return null;
		try {
			const parsed = JSON.parse(trimmed);
			return normaliseEntry(parsed);
		} catch {
			const qtyMatch = trimmed.match(/x\s*(\d+)$/i);
			const qty = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10) || 1) : 1;
			const name = qtyMatch ? trimmed.replace(/x\s*\d+$/i, "").trim() : trimmed;
			const price = extractAndConvertFloat(trimmed);
			const id =
				name
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-+|-+$/g, "") || `item-${Date.now()}`;
			return {
				id,
				name,
				price: Number.isFinite(price) ? price : 0,
				qty,
			};
		}
	}

	if (typeof entry === "object") {
		const candidate = entry as Partial<CartItem> & { name?: string };
		if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;
		const priceCandidate =
			typeof candidate.price === "number" && Number.isFinite(candidate.price)
				? candidate.price
				: extractAndConvertFloat(candidate.name);
		const qtyCandidate =
			typeof candidate.qty === "number" && Number.isFinite(candidate.qty) && candidate.qty > 0
				? Math.floor(candidate.qty)
				: 1;
		const idCandidate =
			typeof candidate.id === "string" && candidate.id.trim()
				? candidate.id
				: candidate.name
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-+|-+$/g, "") || `item-${Date.now()}`;
		return {
			id: idCandidate,
			name: candidate.name.trim(),
			price: Number.isFinite(priceCandidate) ? priceCandidate : 0,
			qty: qtyCandidate,
		};
	}

	return null;
}

function computeSum(items: CartItem[]): number {
	return items.reduce((acc, item) => acc + item.price * item.qty, 0);
}

function readCart(): { items: CartItem[]; total: number } {
	if (typeof window === "undefined") {
		return { items: [], total: 0 };
	}
	try {
		const raw = localStorage.getItem(MY_ITEMS);
		const parsed = raw ? JSON.parse(raw) : [];
		const items = Array.isArray(parsed) ? (parsed.map((entry) => normaliseEntry(entry)).filter(Boolean) as CartItem[]) : [];
		const total = computeSum(items);
		localStorage.setItem(MY_ITEMS, JSON.stringify(items));
		localStorage.setItem(CURRENT, total.toString());
		return { items, total };
	} catch {
		return { items: [], total: 0 };
	}
}

function writeCart(items: CartItem[]): number {
	const total = computeSum(items);
	localStorage.setItem(MY_ITEMS, JSON.stringify(items));
	localStorage.setItem(CURRENT, total.toString());
	return total;
}

export default function useCart() {
	const initialCart = typeof window !== "undefined" ? readCart() : { items: [], total: 0 };
	const [items, setItems] = useState<CartItem[]>(initialCart.items);
	const [currentSum, setCurrentSum] = useState<number>(initialCart.total);
	const { notify } = useNotifications();
	const router = useRouter();

	const refreshFromStorage = useCallback(() => {
		const { items: nextItems, total } = readCart();
		setItems(nextItems);
		setCurrentSum(total);
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;
		refreshFromStorage();
		const onStorage = (event: StorageEvent) => {
			if (!event.key || [MY_ITEMS, PASSED, CURRENT, IS_CLICKED].includes(event.key)) {
				refreshFromStorage();
			}
		};
		window.addEventListener("storage", onStorage);
		const interval = setInterval(refreshFromStorage, 750);
		return () => {
			window.removeEventListener("storage", onStorage);
			clearInterval(interval);
		};
	}, [refreshFromStorage]);

	type ResetOptions = { silent?: boolean };

	const reset = useCallback(
		(options?: ResetOptions) => {
			if (typeof window === "undefined") return;
			const empty: CartItem[] = [];
			writeCart(empty);
			localStorage.setItem(PASSED, "0");
			localStorage.setItem(IS_CLICKED, "0");
			setItems(empty);
			setCurrentSum(0);
			window.dispatchEvent(new StorageEvent("storage", { key: MY_ITEMS, newValue: JSON.stringify(empty) }));
			if (!options?.silent) {
				notify("Your bag is now empty.", 5000, "info", "bag");
			}
		},
		[notify]
	);

	const placeOrder = useCallback(() => {
		const total = computeSum(items);
		if (total === 0) {
			notify("Your bag is empty. You'll need to pick something delicious before checking out.", 8000, "error", "bag", {
				actions: [
					{
						id: "browse-coffee",
						label: "Browse coffee",
						variant: "primary",
						onClick: () => router.push(buildPageHref("coffee")),
					},
					{
						id: "stay",
						label: "No",
						variant: "ghost",
					},
				],
				persist: true,
			});
			return;
		}
		const formatted = `${total.toFixed(2).replace(".", ",")} RON`;
		notify(`Your order worth ${formatted}. Continue to payment?`, 12000, "success", "bag", {
			actions: [
				{
					id: "go-payment",
					label: "OK",
					variant: "primary",
					onClick: () => {
						if (typeof window !== "undefined") {
							// store a timestamp token in sessionStorage — more robust against
							// development double-mount/unmount and scoped to the browser tab
							try {
								window.sessionStorage.setItem("allow_payment_ts", String(Date.now()));
							} catch {
								// ignore storage errors
							}
						}
						router.push(buildPageHref("payment"));
					},
				},
				{
					id: "stay",
					label: "No",
					variant: "ghost",
				},
			],
			persist: true,
		});
	}, [items, notify, router]);

	const addItem = useCallback((item: { id: string; name: string; price: number; qty?: number; image?: string }) => {
		if (typeof window === "undefined") return;
		const qty = item.qty ?? 1;
		const { items: existingItems } = readCart();
		const nextItems = [...existingItems];
		const idx = nextItems.findIndex((entry) => entry.id === item.id);
		if (idx >= 0) {
			nextItems[idx] = {
				...nextItems[idx],
				qty: nextItems[idx].qty + qty,
			};
		} else {
			nextItems.push({ id: item.id, name: item.name, price: item.price, qty, ...(item.image && { image: item.image }) });
		}
		const total = writeCart(nextItems);
		localStorage.setItem(IS_CLICKED, "1");
		localStorage.setItem(PASSED, "0");
		setItems(nextItems);
		setCurrentSum(total);
		window.dispatchEvent(new StorageEvent("storage", { key: MY_ITEMS, newValue: JSON.stringify(nextItems) }));
	}, []);

	const removeItem = useCallback((id: string) => {
		if (typeof window === "undefined") return;
		const { items: existingItems } = readCart();
		const nextItems = existingItems.filter((item) => item.id !== id);
		const total = writeCart(nextItems);
		setItems(nextItems);
		setCurrentSum(total);
		window.dispatchEvent(new StorageEvent("storage", { key: MY_ITEMS, newValue: JSON.stringify(nextItems) }));
	}, []);

	const updateQuantity = useCallback((id: string, newQty: number) => {
		if (typeof window === "undefined") return;
		if (newQty < 1) return; // Don't allow quantity less than 1
		const { items: existingItems } = readCart();
		const nextItems = existingItems.map((item) => (item.id === id ? { ...item, qty: newQty } : item));
		const total = writeCart(nextItems);
		setItems(nextItems);
		setCurrentSum(total);
		window.dispatchEvent(new StorageEvent("storage", { key: MY_ITEMS, newValue: JSON.stringify(nextItems) }));
	}, []);

	return {
		items,
		currentSum,
		reset,
		placeOrder,
		addItem,
		removeItem,
		updateQuantity,
		refresh: refreshFromStorage,
	};
}
