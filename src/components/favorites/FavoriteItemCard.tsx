"use client";

import React, { useState, useRef } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import { ShoppingCartIcon, HeartIcon } from "@/icons";
import useCart from "@/hooks/useCart";
import { useNotifications } from "@/components/NotificationsProvider";
import { useFavorites } from "@/components/FavoritesProvider";
import AddCapsulesPopup from "@/components/AddCapsulesPopup";
import { formatPerUnit, type StockInfo } from "@/components/coffee/CoffeePageContent";
import { type MachineStockInfo } from "@/components/machines/MachinesPageContent";
import { type CoffeeProduct } from "@/data/coffee";
import { type MachineProduct } from "@/data/machines";

interface FavoriteItemCardProps {
	product: CoffeeProduct | MachineProduct;
	type: "capsule" | "machine";
	category: string;
	stockInfo?: StockInfo | MachineStockInfo;
	stockLoading?: boolean;
}

export default function FavoriteItemCard({ product, type, category, stockInfo, stockLoading }: FavoriteItemCardProps) {
	const { addItem } = useCart({ passive: true });
	const { notify } = useNotifications();
	const { isFavorite, toggleFavorite } = useFavorites();
	const [popupOpen, setPopupOpen] = useState(false);
	const cartButtonRef = useRef<HTMLButtonElement>(null);
	const [scrollDir, setScrollDir] = useState<"up" | "down">("down");
	const lastScrollY = useRef(0);

	React.useEffect(() => {
		const updateScrollDir = () => {
			const scrollY = window.scrollY;
			setScrollDir(scrollY > lastScrollY.current ? "down" : "up");
			lastScrollY.current = scrollY;
		};
		window.addEventListener("scroll", updateScrollDir);
		return () => window.removeEventListener("scroll", updateScrollDir);
	}, []);

	const stock = stockInfo?.stock ?? 0;
	// Coffee uses stock < 40 for low, machines use stock < 4
	const isLowStockLimit = type === "capsule" ? 40 : 4;
	const isOutOfStock = stockInfo?.stockStatus === "out_of_stock" || stock <= 0;
	const isLowStock = stockInfo?.stockStatus === "low_stock" || (stock > 0 && stock < isLowStockLimit);

	const handleAction = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (isOutOfStock) return;

		if (type === "capsule") {
			setPopupOpen(true);
		} else {
			const itemName = `${product.name} - ${product.priceRon.toFixed(2).replace(".", ",")} RON`;
			const added = await addItem({
				id: product.id,
				name: itemName,
				price: product.priceRon,
				image: product.image,
				productType: "machine",
			});
			if (added) {
				notify(`Added ${product.name} to bag!`, 6000, "success", "machine");
			}
		}
	};

	const handleConfirmCapsules = async (capsules: number) => {
		if (capsules >= 10) {
			const sleeves = Math.floor(capsules / 10);
			const itemName = `${product.name} - ${product.priceRon.toFixed(2).replace(".", ",")} RON`;
			const cartProductId = stockInfo?.productId || product.id;
			const added = await addItem({
				id: cartProductId,
				name: itemName,
				price: product.priceRon,
				qty: sleeves,
				image: product.image,
				productType: "capsule",
			});
			if (added) {
				notify(
					`Added ${sleeves} sleeve${sleeves > 1 ? "s" : ""} (${capsules} capsules) of ${product.name} to bag!`,
					6000,
					"success",
					"coffee",
				);
			}
		}
		setPopupOpen(false);
	};

	const perUnit = type === "capsule" ? formatPerUnit(product as CoffeeProduct) : null;

	const getStockDisplay = () => {
		if (stockLoading) return <div className="stock-badge loading">Loading...</div>;
		if (isOutOfStock) return <div className="stock-badge out-of-stock">Out of Stock</div>;
		if (isLowStock) return <div className="stock-badge low-stock">{stock} left in stock</div>;
		return <div className="stock-badge in-stock">In Stock</div>;
	};

	const cardClasses = [
		type === "capsule" ? "coffee_groups_capsules" : "machine_groups_models",
		"favorite-product-card",
		isOutOfStock ? "out-of-stock" : "",
	]
		.filter(Boolean)
		.join(" ");

	const imageStyle: React.CSSProperties = {
		width: "80%",
		height: "auto",
		margin: "0 auto",
		display: "block",
		objectFit: "contain",
	};

	return (
		<>
			<motion.div
				className={cardClasses}
				initial={{ opacity: 0, y: scrollDir === "down" ? 20 : -20 }}
				whileInView={{ opacity: 1, y: 0 }}
				viewport={{ once: false, amount: 0.1, margin: "0px 0px -50px 0px" }}
				transition={{ duration: 0.6, ease: "easeOut" }}
				whileHover={{ y: -5 }}
				style={{ position: "relative", padding: "20px" }}
			>
				<button
					className="favorite-card-button"
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						toggleFavorite(type, product.id, category);
					}}
					style={{ top: "10px", right: "10px", bottom: "auto" }}
				>
					<HeartIcon filled={isFavorite(type, product.id)} size={20} />
				</button>

				<div
					className="product-image-container"
					style={{ height: "180px", display: "flex", alignItems: "center", marginBottom: "15px" }}
				>
					<Image
						src={product.image}
						alt={product.name}
						width={200}
						height={200}
						style={imageStyle}
						unoptimized={product.image.startsWith("http")}
					/>
				</div>

				<div className="product-info" style={{ textAlign: "center" }}>
					<h3
						style={{
							fontSize: "1.05rem",
							fontWeight: "600",
							marginBottom: "8px",
							minHeight: "3rem",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						{product.name}
					</h3>

					{getStockDisplay()}

					<div
						className="price-container"
						style={{ marginTop: "10px", display: "flex", flexDirection: "column", alignItems: "center" }}
					>
						<span className="price" style={{ fontSize: "1.2rem", fontWeight: "700" }}>
							{product.priceRon.toFixed(2).replace(".", ",")} RON
						</span>
						{perUnit && (
							<span className="per-unit" style={{ fontSize: "0.8rem", opacity: 0.7 }}>
								{product.unitLabel} • {perUnit}
							</span>
						)}
					</div>

					<button
						className={`cart-action-button ${isOutOfStock ? "disabled" : ""}`}
						onClick={handleAction}
						disabled={isOutOfStock}
						style={{
							marginTop: "15px",
							width: "100%",
							padding: "10px",
							borderRadius: "12px",
							background: isOutOfStock ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #ffdba8, #f2a67b)",
							color: isOutOfStock ? "rgba(255,255,255,0.3)" : "#1d1919",
							border: "none",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: "10px",
							cursor: isOutOfStock ? "not-allowed" : "pointer",
							fontWeight: "600",
						}}
					>
						<ShoppingCartIcon size={20} color={isOutOfStock ? "rgba(255,255,255,0.3)" : "#1d1919"} />
						{isOutOfStock ? "Out of Stock" : "Add to Bag"}
					</button>
				</div>
			</motion.div>

			{type === "capsule" && (
				<AddCapsulesPopup
					open={popupOpen}
					productName={product.name}
					defaultValue={10}
					onClose={() => setPopupOpen(false)}
					onConfirm={handleConfirmCapsules}
				/>
			)}
		</>
	);
}
