import { useEffect, useMemo, useState } from "react";
import { machineCollections, type MachineCollection } from "@/data/machines";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type UseMachineCollectionsResult = {
	collections: MachineCollection[];
	loading: boolean;
	error: string | null;
};

type ApiMachineProduct = {
	productId: string;
	productType: string;
	category: string;
	name: string;
	description?: string;
	notes?: string[] | null;
	image?: string | null;
	boxClass?: string | null;
	wrapperClass?: string | null;
	unitLabel?: string | null;
	priceClass?: string | null;
	priceText?: string | null;
	extraClass?: string[] | null;
	price?: number;
	stock?: number;
	stockStatus?: string;
};

type ProductMap = Map<string, ApiMachineProduct>;

const normalizeKey = (value: string) =>
	(value || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[^a-z0-9\s]/g, "")
		.trim();

// Hook now hydrates collections from API, falling back to static data
export function useMachineCollections(): UseMachineCollectionsResult {
	const [collections, setCollections] = useState<MachineCollection[]>(machineCollections);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function fetchFromApi() {
			try {
				const res = await fetch(`${API_BASE}/api/products/machines`);
				if (!res.ok) throw new Error(`API responded with ${res.status}`);
				const data = await res.json();
				const products: ApiMachineProduct[] = Array.isArray(data.products) ? data.products : [];

				const productMap: ProductMap = new Map();
				for (const p of products) {
					productMap.set(p.productId, p);
				}

				const merged = machineCollections.map((collection) => {
					const groups = collection.groups.map((group) => ({
						...group,
						products: group.products.map((product) => {
							const match = productMap.get(product.id);
							if (!match) return product;

							return {
								...product,
								name: match.name || product.name,
								description: match.description || product.description,
								notes: Array.isArray(match.notes) && match.notes.length ? match.notes : product.notes,
								image: match.image || product.image,
								boxClass: match.boxClass || product.boxClass,
								wrapperClass: match.wrapperClass || product.wrapperClass,
								priceRon: typeof match.price === "number" ? match.price : product.priceRon,
								unitLabel: match.unitLabel || product.unitLabel,
								priceClass: match.priceClass || product.priceClass,
								extraClass:
									Array.isArray(match.extraClass) && match.extraClass.length
										? match.extraClass
										: product.extraClass,
							};
						}),
					}));
					return { ...collection, groups };
				});

				if (!cancelled) setCollections(merged);
				if (!cancelled) setError(null);
			} catch (err: any) {
				if (!cancelled) setError(err?.message ?? "Failed to load machine collections");
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		fetchFromApi();
		return () => {
			cancelled = true;
		};
	}, []);

	const memoCollections = useMemo(() => collections, [collections]);
	return { collections: memoCollections, loading, error };
}
