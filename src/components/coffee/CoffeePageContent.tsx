"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import useCart from "@/hooks/useCart";
import { useNotifications } from "@/components/NotificationsProvider";
import { useFavorites } from "@/components/FavoritesProvider";
import { HeartIcon } from "@/icons";
import AddCapsulesPopup from "@/components/AddCapsulesPopup";
import CoffeeRecommender from "@/components/CoffeeRecommender";
import type { CoffeeCollection, CoffeeGroup, CoffeeProduct } from "@/data/coffee";
import { useCoffeeCollections } from "@/hooks/useCoffeeCollections";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type StockInfo = {
	productId: string;
	stock: number;
	stockStatus: "in_stock" | "low_stock" | "out_of_stock";
};

export type StockContextType = {
	stockData: Map<string, StockInfo>;
	isLoading: boolean;
};

export const StockContext = createContext<StockContextType>({ stockData: new Map(), isLoading: true });

function useStock() {
	return useContext(StockContext);
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

export function formatRon(value: number) {
	return `${value.toFixed(2).replace(".", ",")} RON`;
}

export function formatPerUnit(product: CoffeeProduct) {
	if (!product.unitCount || product.unitCount <= 0) return null;
	const unitPrice = product.priceRon / product.unitCount;
	return `Capsule price: ${unitPrice.toFixed(2).replace(".", ",")} RON`;
}

export function ProductIntensity({ value, scale = 13 }: { value?: number; scale?: number }) {
	if (!value) return null;
	const total = Math.max(scale ?? 0, value);
	const filledBars = Array.from({ length: Math.min(value, total) });
	const emptyBars = Array.from({ length: Math.max(total - value, 0) });
	return (
		<div className="intensity">
			<div className="text_intensity">Intensity</div>
			{filledBars.map((_, idx) => (
				<span key={`filled-${idx}`} className="bar filled" />
			))}
			<div className="text_intensity">
				<strong>{value}</strong>
			</div>
			{emptyBars.map((_, idx) => (
				<span key={`empty-${idx}`} className="bar" />
			))}
		</div>
	);
}

export function ProductServings({ servings }: { servings: CoffeeProduct["servings"] }) {
	const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
	const boxRefs = React.useRef<(HTMLDivElement | null)[]>([]);
	const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties | undefined>(undefined);

	React.useEffect(() => {
		if (hoveredIdx === null) return;
		const box = boxRefs.current[hoveredIdx];
		if (!box) return;
		const rect = box.getBoundingClientRect();
		const parentRect = box.parentElement?.getBoundingClientRect();
		if (!parentRect) return;
		const left = rect.left - parentRect.left + rect.width / 2 - 60; // 60px is half min-width
		const top = rect.bottom - parentRect.top + 8;
		setPopoverStyle({ left: Math.max(8, left), top, position: "absolute" });
	}, [hoveredIdx]);

	if (!servings.length) return null;
	return (
		<div className="box_coffee_made" style={{ position: "relative" }}>
			{servings.map((serving, idx) => (
				<div
					key={`${serving.title}-${idx}`}
					className="box_coffee_type"
					ref={(el) => {
						boxRefs.current[idx] = el;
					}}
					tabIndex={0}
					aria-haspopup="true"
					aria-expanded={hoveredIdx === idx}
					onMouseEnter={() => setHoveredIdx(idx)}
					onMouseLeave={() => setHoveredIdx(null)}
					onFocus={() => setHoveredIdx(idx)}
					onBlur={() => setHoveredIdx(null)}
				>
					<Image src={serving.icon} alt={serving.title} width={32} height={32} />
					<div className="text_coffee_made">{serving.volume}</div>
					{/* Popover for label/title, always mounted for smooth transition */}
					<div
						className={`note-plus-popover${hoveredIdx === idx ? " visible" : ""}`}
						style={popoverStyle}
						role="tooltip"
						aria-hidden={hoveredIdx !== idx}
					>
						<div className="note-plus-item">{serving.title}</div>
					</div>
				</div>
			))}
		</div>
	);
}

// NotePills: renders notes fitted on a single row and shows a +N pill when there isn't space
export function NotePills({ notes, productId }: { notes: string[]; productId: string }) {
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	const [visibleCount, setVisibleCount] = React.useState(notes.length);

	React.useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const gap = 6; // matches CSS gap

		function compute() {
			const root = containerRef.current;
			if (!root) return;
			const available = root.clientWidth;
			// measure all note pills (we render hidden measurement nodes below)
			const meas = Array.from(root.querySelectorAll<HTMLElement>(".note-pill-measure"));
			const plusMeas = root.querySelector<HTMLElement>(".note-plus-measure");
			let used = 0;
			let fit = 0;
			for (let i = 0; i < meas.length; i++) {
				const w = Math.ceil(meas[i].getBoundingClientRect().width);
				const add = (fit === 0 ? 0 : gap) + w;
				// if we can't fit this one, break and consider plus width
				if (used + add > available) break;
				used += add;
				fit++;
			}
			// if there are remaining notes and plus width won't fit, reduce fit until it does
			if (fit < notes.length && plusMeas) {
				const plusW = Math.ceil(plusMeas.getBoundingClientRect().width) + gap;
				while (fit > 0 && used + plusW > available) {
					// remove last fitted note
					const last = meas[fit - 1];
					const lastW = Math.ceil(last.getBoundingClientRect().width) + (fit - 1 === 0 ? 0 : gap);
					used -= lastW;
					fit -= 1;
				}
				// if fit is 0 but plus still doesn't fit, show at least 1
				if (fit === 0 && notes.length > 0) fit = 1;
			}
			setVisibleCount(fit || Math.min(notes.length, 1));
		}

		compute();
		const ro = new ResizeObserver(compute);
		// containerRef.current is non-null here because we returned early if missing
		ro.observe(containerRef.current!);
		return () => ro.disconnect();
	}, [notes]);

	const remaining = Math.max(0, notes.length - visibleCount);
	const [open, setOpen] = React.useState(false);
	const plusRef = React.useRef<HTMLSpanElement | null>(null);
	const popoverRef = React.useRef<HTMLDivElement | null>(null);
	const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties | undefined>(undefined);

	// handlers that keep the popover open when the mouse is over the + pill or the popover
	const openPopover = () => setOpen(true);
	const closePopover = () => setOpen(false);

	const hiddenNotes = notes.slice(visibleCount);

	React.useEffect(() => {
		function updatePosition() {
			const pill = plusRef.current;
			const pop = popoverRef.current;
			const root = containerRef.current;
			if (!pill || !pop || !root) return;

			const pillRect = pill.getBoundingClientRect();
			const rootRect = root.getBoundingClientRect();

			// position popover centered below the pill, relative to the notes_row container
			let left = pillRect.left - rootRect.left + pillRect.width / 2 - pop.offsetWidth / 2;
			const top = pillRect.bottom - rootRect.top + 8; // 8px gap

			// constraint to root bounds
			if (left < 4) left = 4;
			if (left + pop.offsetWidth > rootRect.width - 4) {
				left = rootRect.width - pop.offsetWidth - 4;
			}

			setPopoverStyle({
				left: left + "px",
				top: top + "px",
				position: "absolute",
				zIndex: 2000,
			});
		}

		if (open) {
			updatePosition();
			window.addEventListener("resize", updatePosition);
			window.addEventListener("scroll", updatePosition, true);
			return () => {
				window.removeEventListener("resize", updatePosition);
				window.removeEventListener("scroll", updatePosition, true);
			};
		}
	}, [open]);

	return (
		<div className="notes_row" role="region" aria-labelledby={`notes-label-${productId}`} ref={containerRef}>
			<div className="notes_list" id={`notes-list-${productId}`}>
				{notes.slice(0, visibleCount).map((note, idx) => (
					<span className="note-pill" key={idx}>
						{note}
					</span>
				))}
				{remaining > 0 && (
					<span
						className="note-pill note-plus"
						ref={plusRef}
						tabIndex={0}
						role="button"
						aria-haspopup="listbox"
						aria-expanded={open}
						aria-controls={`${productId}-notes-popover`}
						onMouseEnter={openPopover}
						onMouseLeave={closePopover}
						onFocus={openPopover}
						onBlur={closePopover}
					>
						+{remaining}
					</span>
				)}
			</div>

			{/* popover showing hidden notes when +N is hovered/focused */}
			{remaining > 0 && (
				<div
					id={`${productId}-notes-popover`}
					ref={popoverRef}
					className={`note-plus-popover ${open ? "visible" : ""}`}
					role="listbox"
					aria-hidden={!open}
					onMouseEnter={openPopover}
					onMouseLeave={closePopover}
					style={popoverStyle}
				>
					{hiddenNotes.map((n, i) => (
						<div key={`p-${i}`} className="note-plus-item" role="option" aria-selected="false">
							{n}
						</div>
					))}
				</div>
			)}

			{/* hidden measurement nodes used to compute available fit */}
			<div className="notes-measure" aria-hidden="true">
				{notes.map((note, idx) => (
					<span key={`m-${idx}`} className="note-pill note-pill-measure">
						{note}
					</span>
				))}
				<span className="note-pill note-plus note-plus-measure">+99</span>
			</div>
		</div>
	);
}

export function CoffeeProductCard({ product, category }: { product: CoffeeProduct; category: string }) {
	const { addItem } = useCart();
	const { notify } = useNotifications();
	const { isFavorite, toggleFavorite } = useFavorites();
	const { stockData, isLoading: stockLoading } = useStock();
	const perUnit = formatPerUnit(product);
	const [popupOpen, setPopupOpen] = React.useState(false);
	const addButtonRef = React.useRef<HTMLButtonElement | null>(null);
	const [isInView, setIsInView] = React.useState(false);
	const [scrollDir, setScrollDir] = useState<"up" | "down">("down");
	const lastScrollY = React.useRef(0);
	const defaultCapsules = 10;

	React.useEffect(() => {
		const updateScrollDir = () => {
			const scrollY = window.scrollY;
			setScrollDir(scrollY > lastScrollY.current ? "down" : "up");
			lastScrollY.current = scrollY;
		};
		window.addEventListener("scroll", updateScrollDir);
		return () => window.removeEventListener("scroll", updateScrollDir);
	}, []);

	const getStockInfoFor = (id: string): StockInfo => {
		const direct = stockData.get(id);
		const base = stockData.get(id.replace(/-(original|vertuo|vl)$/i, ""));
		const withOriginal = stockData.get(`${id}-original`);
		const withVertuo = stockData.get(`${id}-vertuo`);
		const withVl = stockData.get(`${id}-vl`); // Database uses -vl for vertuo
		const info = direct || base || withOriginal || withVertuo || withVl;
		if (info) return info;
		return { productId: id, stock: 0, stockStatus: "out_of_stock" };
	};

	// Get stock info for this product (with suffix fallbacks)
	const stockInfo = getStockInfoFor(product.id);
	const stock = stockInfo.stock ?? 0;
	const isOutOfStock = stockInfo.stockStatus === "out_of_stock" || stock <= 0;
	const isLowStock = stockInfo.stockStatus === "low_stock" || (stock > 0 && stock < 40);

	const openPopup = () => {
		if (isOutOfStock) return;
		setPopupOpen(true);
	};

	const closePopup = () => {
		setPopupOpen(false);
		setTimeout(() => {
			addButtonRef.current?.focus({ preventScroll: true });
		}, 0);
	};

	const handleConfirmCapsules = (capsules: number) => {
		if (capsules >= 10) {
			const sleeves = Math.floor(capsules / 10);
			const itemName = `${product.name} - ${formatRon(product.priceRon)}`;
			addItem({ id: product.id, name: itemName, price: product.priceRon, qty: sleeves, image: product.image });
			notify(
				`Added ${sleeves} sleeve${sleeves > 1 ? "s" : ""} (${capsules} capsules) of ${product.name} to bag!`,
				6000,
				"success",
				"coffee",
			);
		}
		closePopup();
	};

	const imageStyle: React.CSSProperties = {
		width: "70%",
		height: "auto",
		display: "block",
		marginLeft: "15%",
		marginRight: "15%",
		marginTop: `${product.imageOffsetY ?? -5}%`,
		objectFit: "contain",
	};
	if (product.imageScale && product.imageScale !== 1) {
		imageStyle.transform = `scale(${product.imageScale})`;
		imageStyle.transformOrigin = "50% 50%";
	}

	const cardClasses = ["coffee_groups_capsules", ...(product.extraClass ?? []), isOutOfStock ? "out-of-stock" : ""]
		.filter(Boolean)
		.join(" ");
	const priceWrapperClass = product.priceClass ? `bag_group ${product.priceClass}` : "bag_group";

	// Stock status display
	const getStockDisplay = () => {
		if (stockLoading) return null;
		if (isOutOfStock) {
			return <div className="stock-badge out-of-stock">Out of Stock</div>;
		}
		if (isLowStock) {
			return <div className="stock-badge low-stock">{stock} left in stock</div>;
		}
		return <div className="stock-badge in-stock">In Stock</div>;
	};

	return (
		<>
			<motion.div
				className={cardClasses}
				style={{ position: "relative" }}
				initial={{ opacity: 0, y: scrollDir === "down" ? 20 : -20 }}
				whileInView={{ opacity: 1, y: 0 }}
				viewport={{ once: false, amount: 0.1, margin: "0px 0px -50px 0px" }}
				onViewportEnter={() => setIsInView(true)}
				onViewportLeave={() => setIsInView(false)}
				transition={{ duration: 0.6, ease: "easeOut" }}
			>
				{isInView ? (
					<>
						{isOutOfStock && <div className="out-of-stock-overlay" />}
						<button
							className="favorite-card-button"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								toggleFavorite("capsule", product.id, category);
							}}
							aria-label={isFavorite("capsule", product.id) ? "Remove from favorites" : "Add to favorites"}
						>
							<HeartIcon filled={isFavorite("capsule", product.id)} size={20} color="#C8977B" />
						</button>
						<div className="capsule_box">
							{/* Edition limitée badge: detect either by image path or extraClass */}
							{(product.image?.includes("Limited Edition") || (product.extraClass ?? []).includes("limited")) && (
								<span className="badge-limited">Édition limitée</span>
							)}
							<Image src={product.image} alt={product.name} width={243} height={165} style={imageStyle} />
						</div>
						<h3 className="h3_capsule">{product.name}</h3>
						<div className="text_capsule">{product.description}</div>

						<div className="capsule_footer">
							{product.notes && product.notes.length > 0 ? (
								<NotePills notes={product.notes} productId={product.id} />
							) : null}
							<ProductServings servings={product.servings} />
							<ProductIntensity value={product.intensity} scale={product.intensityScale} />
							<div className={priceWrapperClass}>
								{getStockDisplay()}
								<div className="price">{formatRon(product.priceRon)}</div>
								<div className="price_per_capsule">{product.unitLabel}</div>
								{perUnit ? <div className="price_per_capsule">{perUnit}</div> : null}
								<button
									type="button"
									className={`button_add_bag ${isOutOfStock ? "disabled" : ""}`}
									onClick={openPopup}
									ref={addButtonRef}
									disabled={isOutOfStock}
								>
									{isOutOfStock ? "Out of Stock" : "Add to Bag"}
								</button>
							</div>
						</div>
					</>
				) : (
					<div style={{ minHeight: "440px" }} />
				)}
			</motion.div>
			<AddCapsulesPopup
				open={popupOpen}
				productName={product.name}
				defaultValue={defaultCapsules}
				onClose={closePopup}
				onConfirm={handleConfirmCapsules}
			/>
		</>
	);
}

function CoffeeGroupSection({ group, category }: { group: CoffeeGroup; category: string }) {
	return (
		<div className="coffee_groups">
			<FadeInWhenVisible className="coffee_groups_head">
				<div className="content_coffee_head">
					<h3>
						<strong>{group.title}</strong>
					</h3>
					{group.dimmer ? <div className="text_dimmer">{group.dimmer}</div> : null}
					<br />
					<div className="text_head">{group.description}</div>
				</div>
			</FadeInWhenVisible>
			{group.products.map((product) => (
				<CoffeeProductCard key={product.id} product={product} category={category} />
			))}
		</div>
	);
}

function CoffeeCollectionSection({ collection }: { collection: CoffeeCollection }) {
	// Determine category string (Original or Vertuo)
	const category = collection.id.toLowerCase().includes("vertuo") ? "Vertuo" : "Original";

	return (
		<section className={collection.id}>
			<FadeInWhenVisible>
				<h2 id={collection.id}>{collection.title}</h2>
			</FadeInWhenVisible>
			{collection.groups.map((group) => (
				<CoffeeGroupSection key={group.title} group={group} category={category} />
			))}
		</section>
	);
}

export default function CoffeePageContent() {
	const { collections, loading } = useCoffeeCollections();
	const coffeeCollections = collections ?? [];
	const [stockData, setStockData] = useState<Map<string, StockInfo>>(new Map());
	const [isLoading, setIsLoading] = useState(true);

	// Fetch stock data on mount
	useEffect(() => {
		async function fetchStock() {
			try {
				const res = await fetch(`${API_BASE}/api/products/coffee`);
				if (res.ok) {
					const data = await res.json();
					const stockMap = new Map<string, StockInfo>();

					const addEntry = (key: string, product: any) => {
						stockMap.set(key, {
							productId: product.productId,
							stock: product.stock,
							stockStatus: product.stockStatus,
						});
					};

					for (const product of data.products || []) {
						const pid: string = product.productId;
						addEntry(pid, product);
						// Also add a base key without collection suffix so UI ids match
						// Database uses -vl for vertuo products, not -vertuo
						const base = pid.replace(/-(original|vertuo|vl)$/i, "");
						if (base !== pid && !stockMap.has(base)) {
							addEntry(base, product);
						}
					}
					setStockData(stockMap);
				}
			} catch (error) {
				console.error("Failed to fetch stock data:", error);
			} finally {
				setIsLoading(false);
			}
		}
		fetchStock();
	}, []);

	return (
		<StockContext.Provider value={{ stockData, isLoading }}>
			<main>
				<div className="coffee_pres">
					<Image src="/images/coffee_background_subheader.png" alt="Coffee background" width={1920} height={1080} />
				</div>
				<div className="nav_coffee_type">
					<div className="glass_morph coffee_type">
						<nav>
							<ul>
								{coffeeCollections.map((collection) => (
									<li key={collection.id}>
										<a href={`#${collection.id}`}>
											{collection.title === "Original" ? "Original" : "Vertuo"}
										</a>
									</li>
								))}
							</ul>
						</nav>
					</div>
				</div>
				{coffeeCollections.map((collection) => (
					<CoffeeCollectionSection key={collection.id} collection={collection} />
				))}
				<CoffeeRecommender />
			</main>
		</StockContext.Provider>
	);
}
