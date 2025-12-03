"use client";

import { useCallback, useEffect, useState } from "react";
import { useNotifications } from "@/components/NotificationsProvider";
import { useRouter } from "next/navigation";
import { buildPageHref } from "@/lib/pages";

const API_BASE = "http://localhost:4000/api";

export type CartItem = {
	id: string;
	name: string;
	price: number;
	qty: number;
	image?: string;
	productType?: "capsule" | "machine" | "accessory";
};

export type MemberDiscount = {
	tier: string;
	percent: number;
	amount: number;
};

function computeSum(items: CartItem[]): number {
	return items.reduce((acc, item) => acc + item.price * item.qty, 0);
}

// Helper to get auth token
function getAuthToken(): string | null {
	if (typeof window === "undefined") return null;
	try {
		const account = sessionStorage.getItem("account_session");
		if (account) {
			const parsed = JSON.parse(account);
			return parsed.token || null;
		}
	} catch {
		// ignore
	}
	return null;
}

// Helper to check if user is logged in
function isLoggedIn(): boolean {
	return getAuthToken() !== null;
}

export default function useCart() {
	const [items, setItems] = useState<CartItem[]>([]);
	const [currentSum, setCurrentSum] = useState<number>(0);
	const [memberDiscount, setMemberDiscount] = useState<MemberDiscount>({ tier: "None", percent: 0, amount: 0 });
	const [loading, setLoading] = useState(false);
	const { notify } = useNotifications();
	const router = useRouter();

	// Fetch cart from API
	const fetchCart = useCallback(async () => {
		const token = getAuthToken();
		if (!token) {
			// Not logged in, reset cart state
			setItems([]);
			setCurrentSum(0);
			setMemberDiscount({ tier: "None", percent: 0, amount: 0 });
			return;
		}

		try {
			setLoading(true);
			const res = await fetch(`${API_BASE}/cart`, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			if (res.ok) {
				const data = await res.json();
				const cartItems: CartItem[] = (data.items || []).map(
					(item: {
						id: number;
						productId: string;
						name: string;
						price: number;
						quantity: number;
						image?: string;
						productType?: string;
					}) => ({
						id: item.productId,
						name: item.name,
						price: item.price,
						qty: item.quantity,
						image: item.image,
						productType: item.productType,
					})
				);
				setItems(cartItems);
				setCurrentSum(data.subtotalAfterDiscount ?? data.subtotal ?? computeSum(cartItems));
				setMemberDiscount({
					tier: data.memberTier || "None",
					percent: data.discountPercent || 0,
					amount: data.discountAmount || 0,
				});
			} else if (res.status === 401) {
				// Token expired or invalid
				setItems([]);
				setCurrentSum(0);
				setMemberDiscount({ tier: "None", percent: 0, amount: 0 });
			}
		} catch (error) {
			console.error("Failed to fetch cart:", error);
		} finally {
			setLoading(false);
		}
	}, []);

	// Initial fetch and listen for login/logout events
	useEffect(() => {
		fetchCart();

		// Listen for storage events (login/logout)
		const handleStorageChange = () => {
			fetchCart();
		};

		window.addEventListener("storage", handleStorageChange);

		// Poll for cart updates
		const interval = setInterval(fetchCart, 30000); // Refresh every 30 seconds

		return () => {
			window.removeEventListener("storage", handleStorageChange);
			clearInterval(interval);
		};
	}, [fetchCart]);

	const reset = useCallback(
		async (options?: { silent?: boolean }) => {
			const token = getAuthToken();
			if (!token) {
				setItems([]);
				setCurrentSum(0);
				setMemberDiscount({ tier: "None", percent: 0, amount: 0 });
				if (!options?.silent) {
					notify("Your bag is now empty.", 5000, "info", "bag");
				}
				return;
			}

			try {
				await fetch(`${API_BASE}/cart`, {
					method: "DELETE",
					headers: {
						Authorization: `Bearer ${token}`,
					},
				});
				setItems([]);
				setCurrentSum(0);
				setMemberDiscount({ tier: "None", percent: 0, amount: 0 });
				if (!options?.silent) {
					notify("Your bag is now empty.", 5000, "info", "bag");
				}
			} catch (error) {
				console.error("Failed to clear cart:", error);
				notify("Failed to clear cart.", 5000, "error", "bag");
			}
		},
		[notify]
	);

	const placeOrder = useCallback(() => {
		if (currentSum === 0 || items.length === 0) {
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

		if (!isLoggedIn()) {
			notify("Please log in to place an order.", 8000, "error", "bag", {
				actions: [
					{
						id: "login",
						label: "Log in",
						variant: "primary",
						onClick: () => router.push(buildPageHref("account")),
					},
					{
						id: "stay",
						label: "Cancel",
						variant: "ghost",
					},
				],
				persist: true,
			});
			return;
		}

		// Use currentSum which already includes the member discount
		const formatted = `${currentSum.toFixed(2).replace(".", ",")} RON`;
		notify(`Your order worth ${formatted}. Continue to payment?`, 12000, "success", "bag", {
			actions: [
				{
					id: "go-payment",
					label: "OK",
					variant: "primary",
					onClick: () => {
						if (typeof window !== "undefined") {
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
	}, [items, currentSum, notify, router]);

	const addItem = useCallback(
		async (item: {
			id: string;
			name: string;
			price: number;
			qty?: number;
			image?: string;
			productType?: "capsule" | "machine" | "accessory";
		}) => {
			const token = getAuthToken();
			if (!token) {
				notify("Please log in to add items to your bag.", 5000, "info", "bag", {
					actions: [
						{
							id: "login",
							label: "Log in",
							variant: "primary",
							onClick: () => router.push(buildPageHref("account")),
						},
						{
							id: "cancel",
							label: "Cancel",
							variant: "ghost",
						},
					],
					persist: true,
				});
				return;
			}

			const qty = item.qty ?? 1;
			const productType = item.productType || "capsule";

			try {
				const res = await fetch(`${API_BASE}/cart`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						productType,
						productId: item.id,
						productName: item.name,
						productImage: item.image,
						unitPrice: item.price,
						quantity: qty,
					}),
				});

				if (res.ok) {
					// Refresh cart from server to get proper discounted total
					await fetchCart();
				} else {
					const data = await res.json();
					notify(data.error || "Failed to add item to cart.", 5000, "error", "bag");
				}
			} catch (error) {
				console.error("Failed to add to cart:", error);
				notify("Failed to add item to cart.", 5000, "error", "bag");
			}
		},
		[notify, router, fetchCart]
	);

	const removeItem = useCallback(
		async (id: string) => {
			const token = getAuthToken();
			if (!token) return;

			// Find the cart item's database ID
			const cartItem = items.find((i) => i.id === id);
			if (!cartItem) return;

			try {
				// We need the database ID, but we store productId
				// First, get the cart to find the database ID
				const cartRes = await fetch(`${API_BASE}/cart`, {
					headers: { Authorization: `Bearer ${token}` },
				});

				if (cartRes.ok) {
					const cartData = await cartRes.json();
					const dbItem = cartData.items.find((item: { productId: string; id: number }) => item.productId === id);

					if (dbItem) {
						await fetch(`${API_BASE}/cart/${dbItem.id}`, {
							method: "DELETE",
							headers: { Authorization: `Bearer ${token}` },
						});
					}
				}

				// Refresh cart from server to get proper discounted total
				await fetchCart();
			} catch (error) {
				console.error("Failed to remove item:", error);
				notify("Failed to remove item from cart.", 5000, "error", "bag");
			}
		},
		[items, notify, fetchCart]
	);

	const updateQuantity = useCallback(
		async (id: string, newQty: number) => {
			if (newQty < 1) return;

			const token = getAuthToken();
			if (!token) return;

			try {
				// Get the cart to find the database ID
				const cartRes = await fetch(`${API_BASE}/cart`, {
					headers: { Authorization: `Bearer ${token}` },
				});

				if (cartRes.ok) {
					const cartData = await cartRes.json();
					const dbItem = cartData.items.find((item: { productId: string; id: number }) => item.productId === id);

					if (dbItem) {
						await fetch(`${API_BASE}/cart/${dbItem.id}`, {
							method: "PUT",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${token}`,
							},
							body: JSON.stringify({ quantity: newQty }),
						});
					}
				}

				// Refresh cart from server to get proper discounted total
				await fetchCart();
			} catch (error) {
				console.error("Failed to update quantity:", error);
				notify("Failed to update cart.", 5000, "error", "bag");
			}
		},
		[items, notify, fetchCart]
	);

	return {
		items,
		currentSum,
		memberDiscount,
		loading,
		reset,
		placeOrder,
		addItem,
		removeItem,
		updateQuantity,
		refresh: fetchCart,
	};
}
