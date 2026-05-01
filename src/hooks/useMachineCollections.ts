import { useEffect, useMemo, useState } from "react";
import { machineCollections, type MachineCollection, type MachineProduct } from "@/data/machines";
import { readSnapshot, writeSnapshot } from "@/lib/clientSnapshotCache";

const API_BASE = typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";
const MACHINE_CACHE_KEY = "filspresso_machine_products_cache";
const MACHINE_CACHE_TTL_MS = 5 * 60 * 1000;
const MACHINE_FETCH_TIMEOUT_MS = 3000;

export type UseMachineCollectionsResult = {
	collections: MachineCollection[];
	stockData: Map<string, { productId: string; stock: number; stockStatus: "in_stock" | "low_stock" | "out_of_stock" }>;
	apiDown: boolean;
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
	priceRon?: number;
	stock?: number;
	stockStatus?: string;
};

type ProductMap = Map<string, ApiMachineProduct>;

type MachineStockInfo = {
	productId: string;
	stock: number;
	stockStatus: "in_stock" | "low_stock" | "out_of_stock";
};

type SharedMachineData = {
	products: ApiMachineProduct[];
	error: string | null;
	apiDown: boolean;
};

let sharedMachineDataPromise: Promise<SharedMachineData> | null = null;
let sharedMachineDataSnapshot: SharedMachineData | null = null;
const cachedMachineSnapshot = readSnapshot<SharedMachineData>(MACHINE_CACHE_KEY, MACHINE_CACHE_TTL_MS);
if (cachedMachineSnapshot) {
	sharedMachineDataSnapshot = cachedMachineSnapshot;
}

const normalizeKey = (value: string) =>
	(value || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[^a-z0-9\s]/g, "")
		.trim();

const normalizeCollectionType = (value: string) => {
	const key = normalizeKey(value);
	return key.includes("vertuo") ? "vertuo" : "original";
};

const normalizeStockStatus = (status: unknown, stock: number): MachineStockInfo["stockStatus"] => {
	if (status === "in_stock" || status === "low_stock" || status === "out_of_stock") return status;
	if (stock <= 0) return "out_of_stock";
	if (stock < 4) return "low_stock";
	return "in_stock";
};

const buildMachineStockMap = (products: ApiMachineProduct[]) => {
	const stockMap = new Map<string, MachineStockInfo>();
	for (const product of products) {
		if (!product.productId) continue;
		const stock = Math.max(0, Number(product.stock) || 0);
		stockMap.set(product.productId, {
			productId: product.productId,
			stock,
			stockStatus: normalizeStockStatus(product.stockStatus, stock),
		});
	}
	return stockMap;
};

const fetchSharedMachineData = async (): Promise<SharedMachineData> => {
	if (sharedMachineDataSnapshot) {
		return sharedMachineDataSnapshot;
	}
	if (!sharedMachineDataPromise) {
		sharedMachineDataPromise = (async () => {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), MACHINE_FETCH_TIMEOUT_MS);
			try {
				const res = await fetch(`${API_BASE}/api/products/machines`, {
					cache: "force-cache",
					signal: controller.signal,
				});
				if (!res.ok) {
					return {
						products: [],
						error: `API responded with ${res.status}`,
						apiDown: true,
					};
				}
				const data = await res.json();
				const snapshot: SharedMachineData = {
					products: Array.isArray(data.products) ? data.products : [],
					error: null,
					apiDown: false,
				};
				sharedMachineDataSnapshot = snapshot;
				writeSnapshot(MACHINE_CACHE_KEY, snapshot);
				return snapshot;
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : "Failed to load machine collections";
				return {
					products: [],
					error: message,
					apiDown: true,
				};
			} finally {
				clearTimeout(timeout);
			}
		})();
		sharedMachineDataPromise.finally(() => {
			sharedMachineDataPromise = null;
		});
	}
	return sharedMachineDataPromise;
};

// Hook now hydrates collections from API, falling back to static data
export function useMachineCollections(): UseMachineCollectionsResult {
	const [collections, setCollections] = useState<MachineCollection[]>(machineCollections);
	const [stockData, setStockData] = useState<Map<string, MachineStockInfo>>(new Map());
	const [apiDown, setApiDown] = useState(false);
	const [loading, setLoading] = useState(() => !sharedMachineDataSnapshot);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!sharedMachineDataSnapshot) {
			setLoading(true);
		}
		async function fetchFromApi() {
			try {
				const data = await fetchSharedMachineData();
				const products: ApiMachineProduct[] = data.products;

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
					priceRon: typeof p.price === "number" ? p.price : typeof p.priceRon === "number" ? p.priceRon : 0,
					unitLabel: p.unitLabel || "Machine",
					priceClass: p.priceClass || "bag_group",
					extraClass: Array.isArray(p.extraClass) && p.extraClass.length ? p.extraClass : undefined,
				});

				const merged = machineCollections.map((collection) => {
					const collectionType = normalizeCollectionType(collection.id);
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
								priceRon:
									typeof match.price === "number"
										? match.price
										: typeof match.priceRon === "number"
											? match.priceRon
											: product.priceRon,
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
							(p) =>
								!matchedIds.has(p.productId) &&
								normalizeCollectionType(p.productType) === collectionType &&
								normalizeKey(p.category) === normalizeKey(group.title),
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
						const targetCollection = merged.find(
							(c) => normalizeCollectionType(c.id) === normalizeCollectionType(p.productType),
						);
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

				if (!cancelled) {
					setCollections(merged);
					setStockData(buildMachineStockMap(products));
					setApiDown(data.apiDown);
					setError(data.error);
				}
			} catch (err: unknown) {
				if (!cancelled) {
					const message = err instanceof Error ? err.message : "Failed to load machine collections";
					setError(message);
					setApiDown(true);
					setStockData(new Map());
				}
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
	const memoStockData = useMemo(() => stockData, [stockData]);
	return { collections: memoCollections, stockData: memoStockData, apiDown, loading, error };
}
