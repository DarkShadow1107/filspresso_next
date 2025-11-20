"use client";

import { useState, useEffect } from "react";
import useCart from "@/hooks/useCart";
import { useNotifications } from "@/components/NotificationsProvider";
import { useRouter } from "next/navigation";
import { buildPageHref } from "@/lib/pages";
import { coffeeCollections } from "@/data/coffee";
import { machineCollections } from "@/data/machines";

function formatRon(value: number) {
	return `${value.toFixed(2).replace(".", ",")} RON`;
}

// Helper function to get product image from data
function getProductImage(productId: string): string | undefined {
	// Search in coffee collections
	for (const collection of coffeeCollections) {
		for (const group of collection.groups) {
			for (const product of group.products) {
				if (product.id === productId) {
					return product.image;
				}
			}
		}
	}

	// Search in machine collections
	for (const collection of machineCollections) {
		for (const group of collection.groups) {
			for (const product of group.products) {
				if (product.id === productId) {
					return product.image;
				}
			}
		}
	}

	return undefined;
}

export default function Cart() {
	const { items, currentSum, reset, placeOrder, removeItem, updateQuantity } = useCart();
	const { notify } = useNotifications();
	const router = useRouter();
	const [isLoggedIn, setIsLoggedIn] = useState(false);
	const [isHydrated, setIsHydrated] = useState(false);
	const hasItems = items.length > 0;

	useEffect(() => {
		setIsHydrated(true);
		if (typeof window === "undefined") return;
		// Check both keys for backward compatibility or inconsistency
		const isLoggedInState =
			localStorage.getItem("user_logged_in") === "true" ||
			localStorage.getItem("account_log") === "true" ||
			localStorage.getItem("login_status") === "1";
		setIsLoggedIn(isLoggedInState);
	}, []);

	const handlePlaceOrder = () => {
		if (!isLoggedIn) {
			notify("You need to be logged in to place an order. Please log in to your account.", 8000, "error", "bag", {
				actions: [
					{
						id: "go-account",
						label: "Go to Account",
						variant: "primary",
						onClick: () => router.push(buildPageHref("account")),
					},
					{
						id: "stay",
						label: "Stay",
						variant: "ghost",
					},
				],
				persist: true,
			});
			return;
		}
		placeOrder();
	};

	const displayedTotal = formatRon(currentSum);
	const totalItems = items.reduce((sum, item) => sum + item.qty, 0);
	const shippingFee = currentSum >= 200 ? 0 : 24.99;
	const finalTotal = currentSum + shippingFee;

	return (
		<>
			<div className="cart-container">
				<div className="cart-summary-box">
					<h2 className="cart-title">🛍️ Shopping Bag Summary</h2>
					<div className="cart-stats">
						<div className="stat-item" suppressHydrationWarning>
							<span className="stat-label">Items:</span>
							<span className="stat-value">
								{isHydrated ? totalItems : 0} {isHydrated ? (totalItems === 1 ? "item" : "items") : "items"}
							</span>
						</div>
						<div className="stat-item">
							<span className="stat-label">Subtotal:</span>
							<span className="stat-value">{displayedTotal}</span>
						</div>
						<div className="stat-item">
							<span className="stat-label">Shipping:</span>
							<span className="stat-value shipping-info">
								{shippingFee === 0 ? (
									<>
										<span className="free-shipping">FREE ✓</span>
									</>
								) : (
									<>
										{formatRon(shippingFee)}
										<span className="shipping-note"> (Free over 200 RON)</span>
									</>
								)}
							</span>
						</div>
						<div className="stat-item total-row">
							<span className="stat-label">Total:</span>
							<span className="stat-value total-price">{formatRon(finalTotal)}</span>
						</div>
					</div>
					<div className="cart-actions">
						<button
							id="placeOrderButton"
							type="button"
							className="bag-place-order"
							onClick={handlePlaceOrder}
							disabled={!hasItems}
						>
							{hasItems ? "🚀 Place Order" : "🛒 Bag is Empty"}
						</button>
						<button id="resetButton" type="button" onClick={() => reset()} disabled={!hasItems}>
							🗑️ Empty Bag
						</button>
					</div>
				</div>

				{hasItems ? (
					<div className="cart-items-section">
						<h3 className="items-title">Items in your bag</h3>
						<div className="itemListBag">
							{items.map((item, index) => {
								// Extract product name and price from the formatted string
								const nameParts = item.name.split(" - ");
								const productName = nameParts[0];
								const pricePerItem = item.price;
								const itemTotal = pricePerItem * item.qty;

								// Determine item type based on name/id/price
								const lowerName = productName.toLowerCase();
								const lowerId = item.id.toLowerCase();

								// Check if it's a pack (coffee bundles or machine accessory packs)
								// Forfaits are bundles/packs that contain multiple items
								const isPack =
									lowerName.includes("pack") ||
									lowerName.includes("bundle") ||
									lowerName.includes("set") ||
									lowerName.includes("forfait") ||
									(lowerName.includes("capsule") && lowerName.includes("variety")) ||
									lowerId.includes("pack") ||
									lowerId.includes("bundle") ||
									lowerId.includes("set") ||
									lowerId.includes("forfait");

								// Machines typically have "machine" in name or are single expensive items (>300 RON typically)
								// But exclude packs even if they contain "machine" in the name
								const isMachine =
									!isPack &&
									(lowerName.includes("machine") ||
										(lowerName.includes("vertuo") &&
											(lowerName.includes("pop") || lowerName.includes("next"))) ||
										lowerName.includes("lattissima") ||
										lowerName.includes("citiz") ||
										lowerName.includes("essenza") ||
										lowerName.includes("inissia") ||
										lowerName.includes("pixie") ||
										lowerName.includes("creatista") ||
										(lowerId.includes("machine-") && !lowerId.includes("pack")) ||
										(pricePerItem > 300 && !isPack));

								// Sleeves are individual coffee capsule sleeves (10 capsules)
								const isSleeve = !isMachine && !isPack;

								// Set appropriate unit label
								let unitLabel = "sleeve (10 capsules)";
								if (isMachine) {
									unitLabel = "machine";
								} else if (isPack) {
									unitLabel = "pack";
								}

								// Get image from item or look up from product data
								const itemImage = item.image || getProductImage(item.id);

								return (
									<div key={item.id} className="cart-item-card">
										{itemImage && (
											<div className="cart-item-image">
												<img
													src={itemImage}
													alt={productName}
													style={{
														width: "100%",
														height: "100%",
														objectFit: "contain",
													}}
												/>
											</div>
										)}
										<div className="cart-item-number">{index + 1}</div>
										<div className="cart-item-details">
											<div className="cart-item-name">{productName}</div>
											<div className="cart-item-meta">
												<span className="cart-item-price">
													{formatRon(pricePerItem)} per {unitLabel}
												</span>
											</div>
										</div>
										<div className="cart-item-controls">
											<div className="quantity-controls">
												<button
													className="qty-btn"
													onClick={() => updateQuantity(item.id, item.qty - 1)}
													disabled={item.qty <= 1}
													aria-label="Decrease quantity"
												>
													−
												</button>
												<span className="qty-display">{item.qty}</span>
												<button
													className="qty-btn"
													onClick={() => updateQuantity(item.id, item.qty + 1)}
													disabled={item.qty >= 20}
													aria-label="Increase quantity"
												>
													+
												</button>
											</div>
											<div className="cart-item-total">{formatRon(itemTotal)}</div>
											<button
												className="remove-btn"
												onClick={() => removeItem(item.id)}
												aria-label="Remove item"
												title="Remove from bag"
											>
												×
											</button>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				) : (
					<div className="empty-cart-message">
						<div className="empty-icon">🛒</div>
						<p className="empty-text">Your shopping bag is empty</p>
						<p className="empty-subtext">Add some delicious coffee capsules to get started!</p>
					</div>
				)}
			</div>
		</>
	);
}
