"use client";

import { useState, useEffect, useCallback } from "react";
import useCart from "@/hooks/useCart";
import { useNotifications } from "@/components/NotificationsProvider";
import { useRouter } from "next/navigation";
import { buildPageHref } from "@/lib/pages";
import { readAccountSession } from "@/lib/accountSession";
import type { CoffeeProduct } from "@/data/coffee";
import { useCoffeeCollections } from "@/hooks/useCoffeeCollections";
import { machineCollections } from "@/data/machines";
import type { WeatherData } from "@/lib/weather";
import {
	ShoppingCartIcon,
	TrashIcon,
	RocketIcon,
	TriangleAlertIcon,
	StarIcon,
	CoffeeIcon,
	SimpleCheckedIcon,
	FlameIcon,
	XIcon,
} from "@/icons";

type PopularProduct = {
	product_id: string;
	product_name: string;
	product_image: string | null;
	total_ordered: number;
};

type StockInfo = {
	stock: number;
	stockStatus: "in_stock" | "low_stock" | "out_of_stock";
};

type CapsuleVariant = "original" | "vertuo";

function formatRon(value: number) {
	return `${value.toFixed(2).replace(".", ",")} RON`;
}

function normalizePath(value?: string | null) {
	return (value || "").trim().toLowerCase();
}

function buildVariantStockKey(productId: string, variant: CapsuleVariant) {
	return `${productId}::${variant}`;
}

function inferVariantFromImageOrId(productImage: string | null, productId: string): CapsuleVariant {
	const image = normalizePath(productImage);
	const id = normalizePath(productId);
	if (image.includes("/vertuo/") || /-(vertuo|vl)$/i.test(id)) return "vertuo";
	return "original";
}

function parsePopularNameAndPrice(raw: string) {
	const parts = (raw || "").split(" - ");
	const name = parts[0]?.trim() || raw || "Unknown product";
	const priceToken = parts.length > 1 ? parts[parts.length - 1] : "";
	const parsed = Number(priceToken.replace(/[^0-9,.-]/g, "").replace(",", "."));
	return {
		name,
		priceRon: Number.isFinite(parsed) ? parsed : null,
	};
}

// Helper function to get product image from data
function getProductImage(productId: string, coffeeData: CoffeeProduct[]): string | undefined {
	for (const product of coffeeData) {
		if (product.id === productId) return product.image;
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

function getProductDataByIdAndImage(
	productId: string,
	productImage: string | null,
	coffeeData: CoffeeProduct[],
): CoffeeProduct | undefined {
	const idMatches = coffeeData.filter((p) => p.id === productId);
	if (idMatches.length <= 1) return idMatches[0];

	const wantedImage = normalizePath(productImage);
	if (!wantedImage) return idMatches[0];

	return idMatches.find((p) => normalizePath(p.image) === wantedImage) || idMatches[0];
}

export default function Cart() {
	const { collections } = useCoffeeCollections();
	const coffeeData = collections?.flatMap((c) => c.groups.flatMap((g) => g.products)) ?? [];
	const { items, currentSum, memberDiscount, reset, placeOrder, removeItem, updateQuantity, addItem } = useCart();
	const { notify } = useNotifications();
	const router = useRouter();
	const [isLoggedIn, setIsLoggedIn] = useState(false);
	const [isHydrated, setIsHydrated] = useState(false);
	const [weather, setWeather] = useState<WeatherData | null>(null);
	const [popularProducts, setPopularProducts] = useState<PopularProduct[]>([]);
	const [stockMap, setStockMap] = useState<Record<string, StockInfo>>({});
	const hasItems = items.length > 0;
	const getProductImageForId = useCallback((productId: string) => getProductImage(productId, coffeeData), [coffeeData]);

	// Calculate subtotal before discount (for display purposes)
	const subtotalBeforeDiscount = items.reduce((sum, item) => sum + item.price * item.qty, 0);

	useEffect(() => {
		setIsHydrated(true);
		if (typeof window === "undefined") return;

		const syncLoginState = () => {
			const session = readAccountSession();
			setIsLoggedIn(Boolean(session?.token));
		};
		syncLoginState();
		window.addEventListener("session-update", syncLoginState);
		window.addEventListener("storage", syncLoginState);

		// Fetch weather for shipping warnings
		const fetchWeather = async () => {
			try {
				const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
				const res = await fetch(`${API_BASE}/api/weather`, { keepalive: true });
				if (res.ok) {
					const data = await res.json();
					setWeather(data);
				}
			} catch {
				// Silent fail - weather is optional
			}
		};
		fetchWeather();

		// Fetch popular products for "Members also buy"
		const fetchPopular = async () => {
			try {
				const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
				const res = await fetch(`${API_BASE}/api/orders/popular?limit=7`, { keepalive: true });
				if (res.ok) {
					const data = await res.json();
					setPopularProducts(data.products || []);
				}
			} catch {
				// Silent fail - recommendations are optional
			}
		};
		fetchPopular();

		// Fetch coffee stock for recommendations
		const fetchStock = async () => {
			try {
				const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
				const res = await fetch(`${API_BASE}/api/products/coffee`, { keepalive: true });
				if (res.ok) {
					const data = await res.json();
					const map: Record<string, StockInfo> = {};
					for (const p of data.products || []) {
						const variant: CapsuleVariant = p.productType === "vertuo" ? "vertuo" : "original";
						const info = { stock: p.stock, stockStatus: p.stockStatus } as StockInfo;
						map[buildVariantStockKey(p.productId, variant)] = info;
						// Database uses -vl for vertuo products, not -vertuo
						const base = p.productId.replace(/-(original|vertuo|vl)$/i, "");
						if (base !== p.productId) {
							map[buildVariantStockKey(base, variant)] = info;
						}
					}
					setStockMap(map);
				}
			} catch {
				// Silent fail - stock info optional
			}
		};
		fetchStock();

		return () => {
			window.removeEventListener("session-update", syncLoginState);
			window.removeEventListener("storage", syncLoginState);
		};
	}, []);

	const handleAddPopularItem = async (popular: PopularProduct) => {
		const product = getProductDataByIdAndImage(popular.product_id, popular.product_image, coffeeData);
		const parsed = parsePopularNameAndPrice(popular.product_name);
		const itemName = product?.name || parsed.name;
		const itemPrice = product?.priceRon ?? parsed.priceRon;
		const itemImage = product?.image || popular.product_image || undefined;

		if (itemPrice === null || itemPrice <= 0) {
			notify(`Couldn't determine price for ${itemName}.`, 4000, "error", "bag");
			return;
		}

		const added = await addItem({
			id: popular.product_id,
			name: itemName,
			price: itemPrice,
			qty: 1,
			image: itemImage,
		});
		if (added) {
			notify(`Added ${itemName} to bag!`, 3000, "success", "bag");
		}
	};

	const renderStockBadge = (productId: string, productImage: string | null) => {
		const variant = inferVariantFromImageOrId(productImage, productId);
		const base = productId.replace(/-(original|vertuo|vl)$/i, "");
		const info =
			stockMap[buildVariantStockKey(productId, variant)] ||
			stockMap[buildVariantStockKey(base, variant)] ||
			stockMap[buildVariantStockKey(`${base}-${variant === "vertuo" ? "vertuo" : "original"}`, variant)] ||
			stockMap[buildVariantStockKey(`${base}-vl`, variant)];
		const stock = info?.stock ?? 0;
		const isOutOfStock = info?.stockStatus === "out_of_stock" || stock <= 0;
		const isLowStock = info?.stockStatus === "low_stock" || (stock > 0 && stock < 40);

		if (isOutOfStock) return <span className="popular-stock out">Out of stock</span>;
		if (isLowStock) return <span className="popular-stock low">{stock} left in stock</span>;
		return <span className="popular-stock in">In stock</span>;
	};

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
	// Free shipping for Master tier and above, or orders over 200 RON
	const hasFreeShipping = ["Master", "Virtuoso", "Ambassador"].includes(memberDiscount.tier) || currentSum >= 200;
	const shippingFee = hasFreeShipping ? 0 : 24.99;
	const finalTotal = currentSum + shippingFee;

	return (
		<>
			<div className="cart-container">
				<div className="cart-summary-box">
					<h2 className="cart-title" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
						<ShoppingCartIcon size={24} /> Shopping Bag Summary
					</h2>
					<div className="cart-stats">
						<div className="stat-item" suppressHydrationWarning>
							<span className="stat-label">Items:</span>
							<span className="stat-value">
								{isHydrated ? totalItems : 0} {isHydrated ? (totalItems === 1 ? "item" : "items") : "items"}
							</span>
						</div>
						<div className="stat-item">
							<span className="stat-label">Subtotal:</span>
							<span className="stat-value">{formatRon(subtotalBeforeDiscount)}</span>
						</div>

						{/* Member Discount Row */}
						{memberDiscount.percent > 0 && (
							<div
								className="stat-item"
								style={{
									background: "rgba(16, 185, 129, 0.15)",
									border: "1px solid rgba(16, 185, 129, 0.3)",
								}}
							>
								<span className="stat-label" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
									<StarIcon size={16} />
									<span>
										{memberDiscount.tier} Discount ({memberDiscount.percent}%):
									</span>
								</span>
								<span className="stat-value" style={{ color: "rgb(100, 255, 150)" }}>
									-{formatRon(memberDiscount.amount)}
								</span>
							</div>
						)}

						<div className="stat-item">
							<span className="stat-label">Shipping:</span>
							<span className="stat-value shipping-info">
								{shippingFee === 0 ? (
									<>
										<span
											className="free-shipping"
											style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
										>
											FREE <SimpleCheckedIcon size={14} />
										</span>
										{["Master", "Virtuoso", "Ambassador"].includes(memberDiscount.tier) &&
											currentSum < 200 && (
												<span className="shipping-note" style={{ color: "rgba(100, 255, 150, 0.8)" }}>
													{" "}
													({memberDiscount.tier} benefit)
												</span>
											)}
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
					{weather?.hourly && weather.hourly.precipitation_probability[0] > 50 && (
						<div className="weather-shipping-warning">
							<TriangleAlertIcon size={18} />
							<span className="weather-warning-text">
								{weather.hourly.precipitation_probability[0] >= 80
									? "Heavy rain expected – delivery may be delayed"
									: "Rain in forecast – minor delays possible"}
							</span>
						</div>
					)}
					<div className="cart-actions">
						<button
							id="placeOrderButton"
							type="button"
							className="bag-place-order"
							onClick={handlePlaceOrder}
							disabled={!hasItems}
						>
							{hasItems ? (
								<>
									<RocketIcon size={22} /> <span>Place Order</span>
								</>
							) : (
								<>
									<ShoppingCartIcon size={22} /> <span>Bag is Empty</span>
								</>
							)}
						</button>
						<button id="resetButton" type="button" onClick={() => reset()} disabled={!hasItems}>
							<TrashIcon size={22} /> <span>Empty Bag</span>
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
								const itemImage = item.image || getProductImageForId(item.id);

								const cartRowKey = `${item.id}::${normalizePath(item.image)}::${index}`;

								return (
									<div key={cartRowKey} className="cart-item-card">
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
												style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
											>
												<XIcon size={18} />
											</button>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				) : (
					<div className="empty-cart-message">
						<div className="empty-icon-row">
							<div className="empty-icon">
								<ShoppingCartIcon size={40} color="#ae8966" />
							</div>
							<p className="empty-text">Your shopping bag is empty</p>
						</div>
						<p className="empty-subtext">Add some delicious coffee capsules to get started!</p>
					</div>
				)}

				{/* Members Also Buy Section */}
				{popularProducts.length > 0 && (
					<div className="members-also-buy">
						<h3 className="members-also-buy-title">
							<CoffeeIcon size={24} /> Members Also Buy
						</h3>
						<div className="popular-products-carousel">
							{popularProducts.map((pop, index) => {
								const product = getProductDataByIdAndImage(pop.product_id, pop.product_image, coffeeData);
								const parsed = parsePopularNameAndPrice(pop.product_name);
								const img = pop.product_image || product?.image || getProductImageForId(pop.product_id);
								const alreadyInCart = items.some(
									(item) => item.id === pop.product_id && normalizePath(item.image) === normalizePath(img),
								);
								// Extract just the product name without price (API returns "Name - Price")
								const displayName = product?.name || parsed.name;
								const displayPrice = product?.priceRon ?? parsed.priceRon;
								const stockBadge = renderStockBadge(pop.product_id, pop.product_image);
								const popularKey = `${pop.product_id}::${normalizePath(pop.product_image || img)}::${index}`;

								return (
									<div key={popularKey} className="popular-product-card">
										{img && (
											<div className="popular-product-image">
												<img src={img} alt={displayName} />
											</div>
										)}
										<div className="popular-product-info">
											<div className="popular-product-name" title={displayName}>
												{displayName}
											</div>
											{displayPrice !== null && (
												<div className="popular-product-price">{formatRon(displayPrice)}</div>
											)}
											{stockBadge}
											<div
												className="popular-product-orders"
												style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
											>
												<FlameIcon size={14} /> {pop.total_ordered} ordered
											</div>
										</div>
										<button
											className="popular-add-btn"
											onClick={() => handleAddPopularItem(pop)}
											disabled={alreadyInCart}
											title={alreadyInCart ? "Already in bag" : "Add to bag"}
											style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
										>
											{alreadyInCart ? <SimpleCheckedIcon size={16} /> : "+"}
										</button>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</>
	);
}
