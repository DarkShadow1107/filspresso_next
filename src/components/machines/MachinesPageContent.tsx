"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import useCart from "@/hooks/useCart";
import { useFavorites } from "@/components/FavoritesProvider";
import { HeartIcon } from "@/icons";
import MachineNotificationsProvider, { useMachineNotifications } from "@/components/machines/MachineNotifications";
import { type MachineCollection, type MachineGroup, type MachineProduct } from "@/data/machines";
import { useMachineCollections } from "@/hooks/useMachineCollections";
import React from "react";
import CoffeeRecommender from "@/components/CoffeeRecommender";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type MachineStockInfo = {
	productId: string;
	stock: number;
	stockStatus: "in_stock" | "low_stock" | "out_of_stock";
};

export type MachineStockContextType = {
	stockData: Map<string, MachineStockInfo>;
	isLoading: boolean;
	apiDown: boolean;
};

export const MachineStockContext = createContext<MachineStockContextType>({
	stockData: new Map(),
	isLoading: true,
	apiDown: false,
});

function useMachineStock() {
	return useContext(MachineStockContext);
}

function FadeInWhenVisible({
	children,
	className,
	style,
}: {
	children: React.ReactNode;
	className?: string;
	style?: React.CSSProperties;
}) {
	const [scrollDir, setScrollDir] = useState<"up" | "down">("down");
	const lastScrollY = React.useRef(0);

	useEffect(() => {
		lastScrollY.current = window.scrollY;
		const updateScrollDir = () => {
			const scrollY = window.scrollY;
			setScrollDir(scrollY > lastScrollY.current ? "down" : "up");
			lastScrollY.current = scrollY;
		};
		window.addEventListener("scroll", updateScrollDir);
		return () => window.removeEventListener("scroll", updateScrollDir);
	}, []);

	return (
		<motion.div
			initial={{ opacity: 0, y: scrollDir === "down" ? 20 : -20 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: false, amount: 0.1, margin: "0px 0px -50px 0px" }}
			transition={{ duration: 0.6, ease: "easeOut" }}
			className={className}
			style={style}
		>
			{children}
		</motion.div>
	);
}

function formatRon(value: number) {
	return `${value.toFixed(2).replace(".", ",")} RON`;
}

export const safeImageUrl = (url: string) => {
	if (!url) return "";
	// Skip encoding for data URLs or already absolute URLs starting with http
	if (url.startsWith("data:") || url.startsWith("http")) return url;
	// Handle leading slash: split and encode parts, then rejoin
	const hasLeadingSlash = url.startsWith("/");
	const parts = url.split("/").filter(Boolean);
	const encoded = parts.map((part) => encodeURIComponent(part)).join("/");
	return hasLeadingSlash ? `/${encoded}` : encoded;
};

export function MachineProductCard({ product, category }: { product: MachineProduct; category: string }) {
	const { addItem } = useCart();
	const { isFavorite, toggleFavorite } = useFavorites();
	const { notify } = useMachineNotifications();
	const { stockData, isLoading: stockLoading, apiDown } = useMachineStock();
	const [isInView, setIsInView] = useState(false);
	const [scrollDir, setScrollDir] = useState<"up" | "down">("down");
	const lastScrollY = React.useRef(0);

	React.useEffect(() => {
		const updateScrollDir = () => {
			const scrollY = window.scrollY;
			setScrollDir(scrollY > lastScrollY.current ? "down" : "up");
			lastScrollY.current = scrollY;
		};
		window.addEventListener("scroll", updateScrollDir);
		return () => window.removeEventListener("scroll", updateScrollDir);
	}, []);

	// Get stock info for this product
	const stockInfo = stockData.get(product.id);
	// Only use a default when the API responded (apiDown = false); never fabricate "In Stock" when DB is unreachable
	const stock = stockInfo?.stock ?? (apiDown ? null : null);
	const isOutOfStock = stock === 0;
	const isLowStock = stock !== null && stock > 0 && stock < 4;

	const handleAddToBag = () => {
		if (isOutOfStock) return;
		const itemName = `${product.name} - ${formatRon(product.priceRon)}`;
		addItem({ id: product.id, name: itemName, price: product.priceRon, image: product.image, productType: "machine" });
		// machine-scoped notify
		notify(`Added ${product.name} to bag!`, 6000);
	};

	const baseWrapperClass = product.wrapperClass ?? "machine_groups_models";
	const wrapperClasses = [baseWrapperClass, ...(product.extraClass ?? []), isOutOfStock ? "out-of-stock" : ""]
		.filter(Boolean)
		.join(" ");
	const priceWrapperClass = product.priceClass ? `bag_group ${product.priceClass}` : "bag_group";

	// Stock status display
	const getStockDisplay = () => {
		if (stockLoading) return null;
		// API is down or product not found in DB — show nothing rather than a false "In Stock"
		if (stock === null) return null;
		if (isOutOfStock) {
			return <div className="stock-badge out-of-stock">Out of Stock</div>;
		}
		if (isLowStock) {
			return <div className="stock-badge low-stock">{stock} left in stock</div>;
		}
		return <div className="stock-badge in-stock">In Stock</div>;
	};

	// Match coffee page image styling
	const imageStyle: React.CSSProperties = {
		width: "70%",
		height: "auto",
		display: "block",
		marginLeft: "15%",
		marginRight: "15%",
		objectFit: "contain",
	};

	return (
		<motion.div
			className={wrapperClasses}
			initial={{ opacity: 0, y: scrollDir === "down" ? 20 : -20 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: false, amount: 0.1, margin: "0px 0px -50px 0px" }}
			onViewportEnter={() => setIsInView(true)}
			onViewportLeave={() => setIsInView(false)}
			transition={{ duration: 0.6, ease: "easeOut" }}
			style={{
				contentVisibility: "auto",
				containIntrinsicSize: "1px 800px",
				minHeight: "600px", // Provide a stable layout height
				position: "relative",
			}}
		>
			{isInView ? (
				<>
					<button
						className="favorite-card-button"
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							toggleFavorite("machine", product.id, category);
						}}
						aria-label={isFavorite("machine", product.id) ? "Remove from favorites" : "Add to favorites"}
					>
						<HeartIcon filled={isFavorite("machine", product.id)} size={20} color="#C8977B" />
					</button>
					{isOutOfStock && <div className="out-of-stock-overlay" />}
					<div className={product.boxClass ?? "machine_box"}>
						<Image
							src={safeImageUrl(product.image)}
							alt={product.name}
							width={293}
							height={200}
							sizes="(max-width: 768px) 80vw, 293px"
							className="machine_image"
							style={imageStyle}
							unoptimized={true}
						/>
					</div>
					<h3 className="h3_capsule">{product.name}</h3>
					<div className="text_capsule">{product.description}</div>
					{product.notes?.map((note, idx) => (
						<p key={idx} className="text_capsule_2">
							{note}
						</p>
					))}
					<div className="machine_footer">
						<div className={priceWrapperClass} id="parentDiv2">
							{getStockDisplay()}
							<div className="price" id="sourceDiv2">
								{formatRon(product.priceRon)}
							</div>
							<div className="price_per_capsule">{product.unitLabel}</div>
							<button
								type="button"
								className={`button_add_bag_2 ${isOutOfStock ? "disabled" : ""}`}
								onClick={handleAddToBag}
								disabled={isOutOfStock}
							>
								{isOutOfStock ? "Out of Stock" : "Add to Bag"}
							</button>
						</div>
					</div>
				</>
			) : null}
		</motion.div>
	);
}

function MachineGroupSection({ group, category }: { group: MachineGroup; category: string }) {
	return (
		<div className="machine_groups">
			<FadeInWhenVisible className={group.headerClass ?? "machine_groups_head"}>
				<div className="content_coffee_head">
					<h3>
						<strong>{group.title}</strong>
					</h3>
					<br />
					<div className="text_head">{group.description}</div>
				</div>
			</FadeInWhenVisible>
			{group.products.map((product) => (
				<MachineProductCard key={product.id} product={product} category={category} />
			))}
		</div>
	);
}

function MachineCollectionSection({ collection }: { collection: MachineCollection }) {
	// Determine category string (Original or Vertuo)
	const category = collection.id.toLowerCase().includes("vertuo") ? "Vertuo" : "Original";

	return (
		<section className={collection.id}>
			<FadeInWhenVisible>
				<h2 id={collection.id}>{collection.title}</h2>
			</FadeInWhenVisible>
			{collection.groups.map((group) => (
				<MachineGroupSection key={group.title} group={group} category={category} />
			))}
		</section>
	);
}

export default function MachinesPageContent() {
	const { collections, loading } = useMachineCollections();
	const machineCollections = collections ?? [];
	const [stockData, setStockData] = useState<Map<string, MachineStockInfo>>(new Map());
	const [isLoading, setIsLoading] = useState(true);
	const [apiDown, setApiDown] = useState(false);

	// Fetch stock data on mount
	useEffect(() => {
		async function fetchStock() {
			try {
				const res = await fetch(`${API_BASE}/api/products/machines`);
				if (res.ok) {
					const data = await res.json();
					const stockMap = new Map<string, MachineStockInfo>();
					for (const product of data.products || []) {
						stockMap.set(product.productId, {
							productId: product.productId,
							stock: product.stock,
							stockStatus: product.stockStatus,
						});
					}
					setStockData(stockMap);
				} else {
					// API responded but with an error status (e.g. DB connection failure on backend)
					setApiDown(true);
				}
			} catch (error) {
				console.error("Failed to fetch machine stock data:", error);
				setApiDown(true);
			} finally {
				setIsLoading(false);
			}
		}
		fetchStock();
	}, []);

	return (
		<MachineStockContext.Provider value={{ stockData, isLoading, apiDown }}>
			<MachineNotificationsProvider>
				<main>
					<div className="coffee_pres">
						<Image
							src="/images/machines_background_subheader.png"
							alt="Machines background"
							width={1920}
							height={1080}
						/>
					</div>
					<div className="nav_machine_type">
						<div className="glass_morph machine_type">
							<nav>
								<ul>
									{machineCollections.map((collection) => (
										<li key={collection.id}>
											<a href={`#${collection.id}`}>{collection.title}</a>
										</li>
									))}
								</ul>
							</nav>
						</div>
					</div>
					{machineCollections.map((collection) => (
						<MachineCollectionSection key={collection.id} collection={collection} />
					))}
				</main>
				<CoffeeRecommender />
			</MachineNotificationsProvider>
		</MachineStockContext.Provider>
	);
}
