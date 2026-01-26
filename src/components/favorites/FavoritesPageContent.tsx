"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { buildPageHref } from "@/lib/pages";
import { useFavorites } from "@/components/FavoritesProvider";
import { useCoffeeCollections } from "@/hooks/useCoffeeCollections";
import { useMachineCollections } from "@/hooks/useMachineCollections";
import { StockContext, type StockInfo } from "@/components/coffee/CoffeePageContent";
import { MachineStockContext, type MachineStockInfo } from "@/components/machines/MachinesPageContent";
import FavoriteItemCard from "./FavoriteItemCard";
import { motion } from "motion/react";
import { HeartIcon, CoffeeIcon, RocketIcon } from "@/icons";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function FavoritesPageContent() {
	const { favorites } = useFavorites();
	const { collections: coffeeCollections, loading: coffeeLoading } = useCoffeeCollections();
	const { collections: machineCollections, loading: machineLoading } = useMachineCollections();

	const [coffeeStock, setCoffeeStock] = useState<Map<string, StockInfo>>(new Map());
	const [machineStock, setMachineStock] = useState<Map<string, MachineStockInfo>>(new Map());
	const [isLoadingStocks, setIsLoadingStocks] = useState(true);

	useEffect(() => {
		async function fetchAllStocks() {
			try {
				const [coffeeRes, machineRes] = await Promise.all([
					fetch(`${API_BASE}/api/products/coffee`),
					fetch(`${API_BASE}/api/products/machines`),
				]);

				if (coffeeRes.ok) {
					const data = await coffeeRes.json();
					const map = new Map<string, StockInfo>();
					const products = Array.isArray(data.products) ? data.products : [];
					products.forEach((p: any) => {
						map.set(p.productId, {
							productId: p.productId,
							stock: p.stock,
							stockStatus: p.stockStatus,
						});
					});
					setCoffeeStock(map);
				}

				if (machineRes.ok) {
					const data = await machineRes.json();
					const map = new Map<string, MachineStockInfo>();
					const products = Array.isArray(data.products) ? data.products : [];
					products.forEach((p: any) => {
						map.set(p.productId, {
							productId: p.productId,
							stock: p.stock,
							stockStatus: p.stockStatus,
						});
					});
					setMachineStock(map);
				}
			} catch (error) {
				console.error("Failed to fetch stocks for favorites", error);
			} finally {
				setIsLoadingStocks(false);
			}
		}

		fetchAllStocks();
	}, []);

	// Organize favorites
	const organizedFavs = useMemo(() => {
		const result = {
			capsules: {
				Original: [] as any[],
				Vertuo: [] as any[],
			},
			machines: {
				Original: [] as any[],
				Vertuo: [] as any[],
			},
		};

		if (!coffeeCollections || !machineCollections) return result;

		favorites.forEach((fav) => {
			if (fav.product_type === "capsule") {
				// Search in coffee collections
				for (const col of coffeeCollections) {
					// Check if this collection matches the favorite's category
					const colCategory = col.id === "vertuo" ? "Vertuo" : "Original";
					if (colCategory !== fav.product_category) continue;

					for (const group of col.groups) {
						const product = group.products.find((p) => p.id === fav.product_id);
						if (product) {
							result.capsules[colCategory].push({ product, category: colCategory });
							return;
						}
					}
				}
				// Fallback if category didn't match perfectly
				for (const col of coffeeCollections) {
					for (const group of col.groups) {
						const product = group.products.find((p) => p.id === fav.product_id);
						if (product) {
							const category = col.id === "vertuo" ? "Vertuo" : "Original";
							result.capsules[category].push({ product, category });
							return;
						}
					}
				}
			} else if (fav.product_type === "machine") {
				// Search in machine collections
				for (const col of machineCollections) {
					for (const group of col.groups) {
						const product = group.products.find((p) => p.id === fav.product_id);
						if (product) {
							const category = fav.product_category === "Vertuo" ? "Vertuo" : "Original";
							result.machines[category as "Original" | "Vertuo"].push({ product, category });
							return;
						}
					}
				}
			}
		});

		return result;
	}, [favorites, coffeeCollections, machineCollections]);

	const isEmpty = favorites.length === 0;
	const isLoading = coffeeLoading || machineLoading || isLoadingStocks;

	const getCoffeeStockInfo = (id: string) => {
		const direct = coffeeStock.get(id);
		if (direct) return direct;

		const base = id.replace(/-(original|vertuo|vl)$/i, "");
		return (
			coffeeStock.get(base) ||
			coffeeStock.get(`${id}-original`) ||
			coffeeStock.get(`${id}-vertuo`) ||
			coffeeStock.get(`${id}-vl`) || { productId: id, stock: 0, stockStatus: "out_of_stock" as const }
		);
	};

	const getMachineStockInfo = (id: string) => {
		const info = machineStock.get(id);
		// If we found it in the map, return it
		if (info) return info;

		// Fallback: If it's missing from the map, don't default to out_of_stock immediately
		// if we are still loading, or if the ID exists but the status hasn't loaded.
		// However, for most machines, they should be in the list.
		if (isLoadingStocks) return { productId: id, stock: 0, stockStatus: "loading" as any };

		// If it's really not in the DB, default to something sensible
		return { productId: id, stock: 99, stockStatus: "in_stock" as const };
	};

	return (
		<>
			<main className="favorites-page pt-32 pb-20 min-h-screen bg-[#0a0a0a]">
				<div className="container mx-auto px-4 max-w-7xl">
					<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16">
						<h1 className="text-5xl font-bold mb-4 empty-state-gradient-text">Your Favorites</h1>
						<div className="w-24 h-1 bg-[#C8977B] mx-auto mb-6 rounded-full"></div>
						<p className="text-lg max-w-2xl mx-auto empty-state-gradient-text">
							Quickly access and manage the coffee capsules and machines you love most.
						</p>
					</motion.div>

					{isEmpty && !isLoading ? (
						<motion.div
							initial={{ opacity: 0, y: 30 }}
							animate={{ opacity: 1, y: 0 }}
							className="flex flex-col items-center justify-center py-12"
						>
							<div className="mb-6 relative">
								<div className="absolute inset-0 blur-2xl bg-[#C8977B] opacity-20"></div>
								<HeartIcon size={64} color="#C8977B" strokeWidth={1.5} className="relative z-10" />
							</div>

							<h2 className="text-3xl font-bold mb-3 text-center empty-state-gradient-text">
								Your collection is empty
							</h2>

							<p className="mb-12 max-w-md text-center text-base leading-relaxed empty-state-gradient-text">
								Start exploring our premium selection and heart your favorite blends and machines to build your
								personal collection.
							</p>

							<div className="flex flex-row gap-[2%] justify-center items-center w-full mt-[1%]">
								{/* Coffee Button */}
								<Link
									href={buildPageHref("coffee")}
									className="group px-14 py-4 gap-[4%] rounded-full font-bold text-[#1d1919] transition-all hover:scale-105 active:scale-95 text-base flex items-center justify-center gap-3 metallic-button min-w-[240px] h-[56px] whitespace-nowrap"
								>
									<span className="flex-shrink-0 -translate-y-[2px]">
										<CoffeeIcon size={22} color="#1d1919" />
									</span>
									<span className="leading-none">Explore Coffee</span>
								</Link>

								{/* Rocket Button */}
								<Link
									href={buildPageHref("machines")}
									className="group px-14 py-4 gap-[4%] rounded-full font-bold text-[#1d1919] transition-all hover:scale-105 active:scale-95 text-base flex items-center justify-center gap-3 metallic-button min-w-[240px] h-[56px] whitespace-nowrap"
								>
									<span className="flex-shrink-0 -translate-y-[1px]">
										<RocketIcon size={22} color="#1d1919" />
									</span>
									<span className="leading-none">Meet Machines</span>
								</Link>
							</div>
						</motion.div>
					) : (
						<div className="space-y-24">
							{/* Capsules Section */}
							<StockContext.Provider value={{ stockData: coffeeStock, isLoading: isLoadingStocks }}>
								{(organizedFavs.capsules.Original.length > 0 || organizedFavs.capsules.Vertuo.length > 0) && (
									<section className="space-y-12">
										<div className="flex items-center gap-4">
											<h2 className="text-3xl font-bold text-white whitespace-nowrap">Coffee Selection</h2>
											<div className="h-px bg-white/10 w-full"></div>
										</div>

										{organizedFavs.capsules.Original.length > 0 && (
											<div>
												<h3 className="text-xl font-semibold text-[#C8977B] mb-8 flex items-center gap-2">
													<div className="w-2 h-2 rounded-full bg-[#C8977B]"></div>
													Original Line
												</h3>
												<div className="flex flex-wrap gap-x-[1%] gap-y-[2vw]">
													{organizedFavs.capsules.Original.map(({ product, category }) => (
														<FavoriteItemCard
															key={`${product.id}-${category}`}
															product={product}
															type="capsule"
															category={category}
															stockInfo={getCoffeeStockInfo(product.id)}
															stockLoading={isLoadingStocks}
														/>
													))}
												</div>
											</div>
										)}

										{organizedFavs.capsules.Vertuo.length > 0 && (
											<div>
												<h3 className="text-xl font-semibold text-[#C8977B] mb-8 flex items-center gap-2">
													<div className="w-2 h-2 rounded-full bg-[#C8977B]"></div>
													Vertuo Line
												</h3>
												<div className="flex flex-wrap gap-x-[1%] gap-y-[2vw]">
													{organizedFavs.capsules.Vertuo.map(({ product, category }) => (
														<FavoriteItemCard
															key={`${product.id}-${category}`}
															product={product}
															type="capsule"
															category={category}
															stockInfo={getCoffeeStockInfo(product.id)}
															stockLoading={isLoadingStocks}
														/>
													))}
												</div>
											</div>
										)}
									</section>
								)}
							</StockContext.Provider>

							{/* Machines Section */}
							<MachineStockContext.Provider value={{ stockData: machineStock, isLoading: isLoadingStocks }}>
								{(organizedFavs.machines.Original.length > 0 || organizedFavs.machines.Vertuo.length > 0) && (
									<section className="space-y-12">
										<div className="flex items-center gap-4">
											<h2 className="text-3xl font-bold text-white whitespace-nowrap">
												Machine Collection
											</h2>
											<div className="h-px bg-white/10 w-full"></div>
										</div>

										{organizedFavs.machines.Original.length > 0 && (
											<div>
												<h3 className="text-xl font-semibold text-[#C8977B] mb-8 flex items-center gap-2">
													<div className="w-2 h-2 rounded-full bg-[#C8977B]"></div>
													Original Machines
												</h3>
												<div className="flex flex-wrap gap-x-[1%] gap-y-[2vw]">
													{organizedFavs.machines.Original.map(({ product, category }) => (
														<FavoriteItemCard
															key={`${product.id}-${category}`}
															product={product}
															type="machine"
															category={category}
															stockInfo={getMachineStockInfo(product.id)}
															stockLoading={isLoadingStocks}
														/>
													))}
												</div>
											</div>
										)}

										{organizedFavs.machines.Vertuo.length > 0 && (
											<div>
												<h3 className="text-xl font-semibold text-[#C8977B] mb-8 flex items-center gap-2">
													<div className="w-2 h-2 rounded-full bg-[#C8977B]"></div>
													Vertuo Machines
												</h3>
												<div className="flex flex-wrap gap-x-[1%] gap-y-[2vw]">
													{organizedFavs.machines.Vertuo.map(({ product, category }) => (
														<FavoriteItemCard
															key={`${product.id}-${category}`}
															product={product}
															type="machine"
															category={category}
															stockInfo={getMachineStockInfo(product.id)}
															stockLoading={isLoadingStocks}
														/>
													))}
												</div>
											</div>
										)}
									</section>
								)}
							</MachineStockContext.Provider>
						</div>
					)}
				</div>
			</main>

			<style
				dangerouslySetInnerHTML={{
					__html: `
				.favorites-page {
					background: radial-gradient(circle at top right, #151515 0%, #000000 100%);
				}
				.favorites-page .coffee_groups_capsules,
				.favorites-page .machine_groups_models {
					margin: 0 !important;
					width: 100% !important;
					height: auto !important;
					min-height: 520px !important;
					display: flex !important;
					flex-direction: column !important;
					justify-content: space-between !important;
					flex-shrink: 0 !important;
				}
				@media (min-width: 600px) {
					.favorites-page .coffee_groups_capsules,
					.favorites-page .machine_groups_models {
						width: 49.5% !important;
					}
				}
				@media (min-width: 900px) {
					.favorites-page .coffee_groups_capsules,
					.favorites-page .machine_groups_models {
						width: 32.66% !important;
					}
				}
				@media (min-width: 1200px) {
					.favorites-page .coffee_groups_capsules,
					.favorites-page .machine_groups_models {
						width: 24.25% !important;
					}
				}
				@media (min-width: 1450px) {
					.favorites-page .coffee_groups_capsules,
					.favorites-page .machine_groups_models {
						width: 19.2% !important;
					}
				}
				@media (min-width: 1800px) {
					.favorites-page .coffee_groups_capsules,
					.favorites-page .machine_groups_models {
						width: 15.83% !important;
					}
				}
				.favorites-page .coffee_groups_capsules.out-of-stock,
				.favorites-page .machine_groups_models.out-of-stock {
					pointer-events: auto !important;
				}
				.favorite-product-card {
					background: rgba(255, 255, 255, 0.03) !important;
					border: 1px solid rgba(255, 255, 255, 0.05) !important;
					backdrop-filter: blur(10px) !important;
				}
				.favorites-page .stock-badge {
					display: inline-block;
					padding: 4px 12px;
					border-radius: 20px;
					font-size: 0.75rem;
					font-weight: 600;
					margin-bottom: 10px;
				}
				.favorites-page .stock-badge.in-stock {
					background: rgba(56, 190, 148, 0.1);
					color: #38be94;
				}
				.favorites-page .stock-badge.low-stock {
					background: rgba(242, 166, 123, 0.1);
					color: #f2a67b;
				}
				.favorites-page .stock-badge.out-of-stock {
					background: rgba(248, 113, 113, 0.1);
					color: #f87171;
				}
				.empty-state-gradient-text {
					background-image: linear-gradient(to right, #8E5A3C, #FFDAB9 45%, #FFFFFF 50%, #FFDAB9 55%, #8E5A3C);
					-webkit-background-clip: text;
					-webkit-text-fill-color: transparent;
				}
				.metallic-button {
					background: linear-gradient(135deg, #8E5A3C 0%, #FFDAB9 40%, #FFFFFF 50%, #FFDAB9 60%, #8E5A3C 100%);
					background-size: 200% auto;
					box-shadow: 
						0 10px 30px -10px rgba(0, 0, 0, 0.7),
						inset 0 1px 1px rgba(255, 255, 255, 0.5),
						inset 0 -1px 1px rgba(0, 0, 0, 0.3);
					border: 1px solid rgba(142, 90, 60, 0.4);
					position: relative;
					overflow: hidden;
				}
				.metallic-button:hover {
					background-position: right center;
					box-shadow: 
						0 15px 40px -12px rgba(0, 0, 0, 0.8),
						inset 0 1px 1px rgba(255, 255, 255, 0.6),
						inset 0 -1px 1px rgba(0, 0, 0, 0.2);
					border: 1px solid rgba(142, 90, 60, 0.6);
				}
				.metallic-button::after {
					content: "";
					position: absolute;
					top: -50%;
					left: -50%;
					width: 200%;
					height: 200%;
					background: linear-gradient(
						45deg,
						transparent 0%,
						rgba(255, 255, 255, 0.1) 45%,
						rgba(255, 255, 255, 0.5) 50%,
						rgba(255, 255, 255, 0.1) 55%,
						transparent 100%
					);
					transform: rotate(-45deg);
					transition: all 0.6s ease;
					opacity: 0;
					pointer-events: none;
				}
				.metallic-button:hover::after {
					left: 100%;
					top: 100%;
					opacity: 1;
				}
			`,
				}}
			/>
		</>
	);
}
