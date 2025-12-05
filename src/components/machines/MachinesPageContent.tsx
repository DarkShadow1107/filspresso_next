"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Image from "next/image";
import useCart from "@/hooks/useCart";
import MachineNotificationsProvider, { useMachineNotifications } from "@/components/machines/MachineNotifications";
import { machineCollections, type MachineCollection, type MachineGroup, type MachineProduct } from "@/data/machines";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type StockInfo = {
	productId: string;
	stock: number;
	stockStatus: "in_stock" | "low_stock" | "out_of_stock";
};

type StockContextType = {
	stockData: Map<string, StockInfo>;
	isLoading: boolean;
};

const MachineStockContext = createContext<StockContextType>({ stockData: new Map(), isLoading: true });

function useMachineStock() {
	return useContext(MachineStockContext);
}

function formatRon(value: number) {
	return `${value.toFixed(2).replace(".", ",")} RON`;
}

function MachineProductCard({ product }: { product: MachineProduct }) {
	const { addItem } = useCart();
	const { notify } = useMachineNotifications();
	const { stockData, isLoading: stockLoading } = useMachineStock();

	// Get stock info for this product
	const stockInfo = stockData.get(product.id);
	const stock = stockInfo?.stock ?? 10; // Default to 10 if not loaded
	const isOutOfStock = stock === 0;
	const isLowStock = stock > 0 && stock < 4;

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
		if (isOutOfStock) {
			return <div className="stock-badge out-of-stock">Out of Stock</div>;
		}
		if (isLowStock) {
			return <div className="stock-badge low-stock">{stock} left in stock</div>;
		}
		return <div className="stock-badge in-stock">In Stock</div>;
	};

	return (
		<div className={wrapperClasses}>
			{isOutOfStock && <div className="out-of-stock-overlay" />}
			<div className={product.boxClass ?? "machine_box"}>
				<Image
					src={product.image}
					alt={product.name}
					width={293}
					height={200}
					sizes="(max-width: 768px) 80vw, 293px"
					className="machine_image"
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
		</div>
	);
}

function MachineGroupSection({ group }: { group: MachineGroup }) {
	return (
		<div className="machine_groups">
			<div className={group.headerClass ?? "machine_groups_head"}>
				<div className="content_coffee_head">
					<h3>
						<strong>{group.title}</strong>
					</h3>
					<br />
					<div className="text_head">{group.description}</div>
				</div>
			</div>
			{group.products.map((product) => (
				<MachineProductCard key={product.id} product={product} />
			))}
		</div>
	);
}

function MachineCollectionSection({ collection }: { collection: MachineCollection }) {
	return (
		<section className={collection.id}>
			<h2 id={collection.id}>{collection.title}</h2>
			{collection.groups.map((group) => (
				<MachineGroupSection key={group.title} group={group} />
			))}
		</section>
	);
}

export default function MachinesPageContent() {
	const [stockData, setStockData] = useState<Map<string, StockInfo>>(new Map());
	const [isLoading, setIsLoading] = useState(true);

	// Fetch stock data on mount
	useEffect(() => {
		async function fetchStock() {
			try {
				const res = await fetch(`${API_BASE}/api/products/machines`);
				if (res.ok) {
					const data = await res.json();
					const stockMap = new Map<string, StockInfo>();
					for (const product of data.products || []) {
						stockMap.set(product.productId, {
							productId: product.productId,
							stock: product.stock,
							stockStatus: product.stockStatus,
						});
					}
					setStockData(stockMap);
				}
			} catch (error) {
				console.error("Failed to fetch machine stock data:", error);
			} finally {
				setIsLoading(false);
			}
		}
		fetchStock();
	}, []);

	return (
		<MachineStockContext.Provider value={{ stockData, isLoading }}>
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
			</MachineNotificationsProvider>
		</MachineStockContext.Provider>
	);
}
