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
				const matchedIds = new Set<string>();
				for (const p of products) {
					productMap.set(p.productId, p);
				}

				const convertToMachineProduct = (p: ApiMachineProduct): MachineProduct => ({
					id: p.productId,
					name: p.name,
					description: p.description || "",
					notes: Array.isArray(p.notes) && p.notes.length ? p.notes : undefined,
					image: p.image ? `/${p.image.replace(/^\/+/, "")}` : "/images/placeholder-machine.png",
					boxClass: p.boxClass || "machine_box",
					wrapperClass: p.wrapperClass || "machine_groups_models",
					priceRon: typeof p.price === "number" ? p.price : 0,
					unitLabel: p.unitLabel || "Machine",
					priceClass: p.priceClass || "bag_group",
					extraClass: Array.isArray(p.extraClass) && p.extraClass.length ? p.extraClass : undefined,
				});

				const merged = machineCollections.map((collection) => {
					const groups = collection.groups.map((group) => {
						const groupProducts = group.products.map((product) => {
							const match = productMap.get(product.id);
							if (!match) return product;
							matchedIds.add(product.id);

							return {
								...product,
								name: match.name || product.name,
								description: match.description || product.description,
								notes: Array.isArray(match.notes) && match.notes.length ? match.notes : product.notes,
								image: match.image ? `/${match.image.replace(/^\/+/, "")}` : product.image,
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
						});

						// Add products from API that match this group title but weren't in static list
						const extraInGroup = products.filter(
							(p) => !matchedIds.has(p.productId) && normalizeKey(p.category) === normalizeKey(group.title),
						);

						for (const p of extraInGroup) {
							groupProducts.push(convertToMachineProduct(p));
							matchedIds.add(p.productId);
						}

						return { ...group, products: groupProducts };
					});

					return { ...collection, groups };
				});

				// Handle orphans (products with categories that don't match any existing group)
				const orphans = products.filter((p) => !matchedIds.has(p.productId));
				if (orphans.length > 0) {
					// Group orphans by productType (original/vertuo)
					for (const p of orphans) {
						const targetCollection = merged.find((c) => c.id === p.productType);
						if (targetCollection) {
							let targetGroup = targetCollection.groups.find(
								(g) => normalizeKey(g.title) === normalizeKey(p.category),
							);
							if (!targetGroup) {
								targetGroup = {
									title: p.category || "Other",
									description: "Added from database",
									products: [],
								};
								targetCollection.groups.push(targetGroup);
							}
							targetGroup.products.push(convertToMachineProduct(p));
						}
					}
				}

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
