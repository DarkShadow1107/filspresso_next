import { useEffect, useMemo, useState } from "react";
import { coffeeCollections, type CoffeeCollection } from "@/data/coffee";
import { readSnapshot, writeSnapshot } from "@/lib/clientSnapshotCache";

const API_BASE = typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";
const COFFEE_CACHE_KEY = "filspresso_coffee_products_cache";
const COFFEE_CACHE_TTL_MS = 5 * 60 * 1000;

export type UseCoffeeCollectionsResult = {
	collections: CoffeeCollection[];
	stockData: Map<string, { productId: string; stock: number; stockStatus: "in_stock" | "low_stock" | "out_of_stock" }>;
	loading: boolean;
	error: string | null;
};

type ApiProduct = {
	productId: string;
	productType: string;
	stock?: number;
	stockStatus?: "in_stock" | "low_stock" | "out_of_stock";
	category: string;
	name: string;
	description?: string;
	notes?: string[] | null;
	servings?: Array<{ title: string; volume: string; icon: string }> | null;
	intensity?: number | null;
	price?: number;
	imageFilename?: string | null;
	imageExtension?: string | null;
	imageStyle?: string | null;
	priceClass?: string | null;
	image?: string | null;
};

type ProductMap = Map<string, ApiProduct>;

type StockInfo = {
	productId: string;
	stock: number;
	stockStatus: "in_stock" | "low_stock" | "out_of_stock";
};

type SharedCoffeeData = {
	products: ApiProduct[];
	error: string | null;
};

let sharedCoffeeDataPromise: Promise<SharedCoffeeData> | null = null;
let sharedCoffeeDataSnapshot: SharedCoffeeData | null = null;
const cachedCoffeeSnapshot = readSnapshot<SharedCoffeeData>(COFFEE_CACHE_KEY, COFFEE_CACHE_TTL_MS);
if (cachedCoffeeSnapshot) {
	sharedCoffeeDataSnapshot = cachedCoffeeSnapshot;
}

// Map user-facing category to folder name (mirrors admin uploader logic)
const CATEGORY_FOLDER_MAP: Record<string, Record<string, string>> = {
	original: {
		"coffee+": "Coffee+",
		"craft brew": "Craft Brew",
		"creations barista": "Barista Creations",
		"barista creations": "Barista Creations",
		espresso: "Espresso",
		espressos: "Espresso",
		"édition limitée": "Limited Edition",
		"edition limitee": "Limited Edition",
		"limited edition": "Limited Edition",
		"ispirazione italiana": "Ispirazione Italiana",
		"italian explorations": "Italian Explorations",
		"origines principales": "Master Origins",
		"master origins": "Master Origins",
		"explorations du monde": "World Explorations",
		"world explorations": "World Explorations",
		tasse: "Mug",
		mug: "Mug",
	},
	vertuo: {
		"coffee+": "Coffee+",
		"craft brew": "Craft Brew",
		"double espresso": "Double Espresso",
		espresso: "Espressos",
		espressos: "Espressos",
		"gran lungo": "Gran Lungo",
		"édition limitée": "Limited Edition",
		"edition limitee": "Limited Edition",
		"limited edition": "Limited Edition",
		"barista creation": "Barista Creation",
		"barista creations": "Barista Creation",
		"creations barista": "Barista Creation",
		"master origins": "Master Origins",
		"origines principales": "Master Origins",
		mug: "Mug",
		tasse: "Mug",
	},
};

const normalizeKey = (value: string) =>
	(value || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[^a-z0-9\s]/g, "")
		.trim();

const resolveCategoryFolder = (productType: string, category: string) => {
	const typeKey = productType === "vertuo" ? "vertuo" : "original";
	const catKey = normalizeKey(category);
	return CATEGORY_FOLDER_MAP[typeKey]?.[catKey] || category || "General";
};

const parseImageStyle = (style?: string | null): { imageScale?: number; imageOffsetY?: number } => {
	if (!style) return {};
	const parts = style
		.split(";")
		.map((p) => p.trim())
		.filter(Boolean);
	const result: { imageScale?: number; imageOffsetY?: number } = {};
	for (const part of parts) {
		const [prop, value] = part.split(":").map((p) => p.trim());
		if (!prop || !value) continue;
		if (prop === "scale") {
			const num = Number(value.replace(/[^0-9.\-]/g, ""));
			if (!Number.isNaN(num)) result.imageScale = num;
		} else if (prop === "margin-top") {
			const num = Number(value.replace(/[^0-9.\-]/g, ""));
			if (!Number.isNaN(num)) result.imageOffsetY = num;
		}
	}
	return result;
};

const buildImagePath = (product: ApiProduct) => {
	if (product.image) return product.image;
	const typeDir = product.productType === "vertuo" ? "Vertuo" : "Original";
	const categoryDir = resolveCategoryFolder(product.productType, product.category || "General");
	const baseFilename = product.imageFilename || `${product.productId}.${product.imageExtension || "png"}`;
	return `/images/Capsules/${typeDir}/${categoryDir}/${baseFilename}`;
};

const normalizeStockStatus = (status: unknown, stock: number): StockInfo["stockStatus"] => {
	if (status === "in_stock" || status === "low_stock" || status === "out_of_stock") return status;
	if (stock <= 0) return "out_of_stock";
	if (stock < 40) return "low_stock";
	return "in_stock";
};

const buildStockMap = (products: ApiProduct[]) => {
	const stockMap = new Map<string, StockInfo>();
	for (const product of products) {
		const productId = product.productId || "";
		if (!productId) continue;
		const variant = product.productType === "vertuo" ? "vertuo" : "original";
		const stock = Math.max(0, Number(product.stock) || 0);
		const stockStatus = normalizeStockStatus(product.stockStatus, stock);
		const info: StockInfo = { productId, stock, stockStatus };

		const baseId = productId.replace(/-(original|vertuo|vl)$/i, "");
		const keys = new Set<string>([`${productId}::${variant}`]);
		if (baseId && baseId !== productId) {
			keys.add(`${baseId}::${variant}`);
		}
		if (productId.endsWith("-vertuo")) {
			keys.add(`${productId.replace(/-vertuo$/i, "-vl")}::${variant}`);
		}
		if (productId.endsWith("-vl")) {
			keys.add(`${productId.replace(/-vl$/i, "-vertuo")}::${variant}`);
		}

		for (const key of keys) {
			stockMap.set(key, info);
		}
	}
	return stockMap;
};

const fetchSharedCoffeeData = async (): Promise<SharedCoffeeData> => {
	if (sharedCoffeeDataSnapshot) {
		return sharedCoffeeDataSnapshot;
	}
	if (!sharedCoffeeDataPromise) {
		sharedCoffeeDataPromise = (async () => {
			try {
				const res = await fetch(`${API_BASE}/api/products/coffee`, { cache: "force-cache" });
				if (!res.ok) throw new Error(`API responded with ${res.status}`);
				const data = await res.json();
				const snapshot: SharedCoffeeData = {
					products: Array.isArray(data.products) ? data.products : [],
					error: null,
				};
				sharedCoffeeDataSnapshot = snapshot;
				writeSnapshot(COFFEE_CACHE_KEY, snapshot);
				return snapshot;
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : "Failed to load coffee collections";
				return {
					products: [],
					error: message,
				};
			}
		})();
		sharedCoffeeDataPromise.finally(() => {
			sharedCoffeeDataPromise = null;
		});
	}
	return sharedCoffeeDataPromise;
};

const addProductKeys = (map: ProductMap, product: ApiProduct) => {
	const id = product.productId;
	const baseId = (id || "").replace(/-(original|vertuo|vl)$/i, "");
	const aliases = new Set<string>();
	if (id) aliases.add(id);
	if (baseId && baseId !== id) aliases.add(baseId);
	if (id.endsWith("-vertuo")) aliases.add(id.replace(/-vertuo$/i, "-vl"));
	if (id.endsWith("-vl")) aliases.add(id.replace(/-vl$/i, "-vertuo"));
	for (const key of aliases) map.set(key, product);
};

const convertToCoffeeProduct = (product: ApiProduct) => {
	const { imageScale, imageOffsetY } = parseImageStyle(product.imageStyle);
	return {
		id: product.productId.replace(/-(original|vertuo)$/i, ""),
		name: product.name || product.productId,
		description: product.description || "",
		image: buildImagePath(product),
		imageScale,
		imageOffsetY,
		intensity: product.intensity ?? undefined,
		intensityScale: 13,
		priceRon: typeof product.price === "number" ? product.price : 0,
		unitLabel: "1 sleeve (10 capsules)",
		unitCount: 10,
		priceClass: product.priceClass || undefined,
		notes: Array.isArray(product.notes) && product.notes.length ? product.notes : undefined,
		servings: Array.isArray(product.servings)
			? product.servings.map((serving) => ({
					icon: `/${(serving.icon || "").replace(/^\/+/g, "")}`,
					title: serving.title,
					volume: serving.volume,
				}))
			: [],
	};
};

// Hook now hydrates collections from API, falling back to static data
export function useCoffeeCollections(): UseCoffeeCollectionsResult {
	const [collections, setCollections] = useState<CoffeeCollection[]>(coffeeCollections);
	const [stockData, setStockData] = useState<Map<string, StockInfo>>(new Map());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		async function fetchFromApi() {
			try {
				const data = await fetchSharedCoffeeData();
				const products: ApiProduct[] = data.products;

				const productMaps: Record<"original" | "vertuo", ProductMap> = {
					original: new Map(),
					vertuo: new Map(),
				};

				for (const product of products) {
					const type = product.productType === "vertuo" ? "vertuo" : "original";
					addProductKeys(productMaps[type], product);
				}

				const matchedIds = new Set<string>();
				const merged = coffeeCollections.map((collection) => {
					const typeKey = collection.id === "vertuo" ? "vertuo" : "original";
					const map = productMaps[typeKey];
					const groupTitleIndex = new Map<string, number>();
					collection.groups.forEach((g, idx) => groupTitleIndex.set(normalizeKey(g.title), idx));

					const groups = collection.groups.map((group) => ({
						...group,
						products: group.products.map((product) => {
							const candidates = [
								product.id,
								`${product.id}-${typeKey}`,
								`${product.id}-${typeKey === "vertuo" ? "vl" : "original"}`,
								`${product.id}-vertuo`,
								`${product.id}-original`,
							];
							const match = candidates.reduce<ApiProduct | undefined>((acc, key) => acc || map.get(key), undefined);

							if (!match) return product;

							matchedIds.add(match.productId);
							const { imageScale, imageOffsetY } = parseImageStyle(match.imageStyle);
							return {
								...product,
								name: match.name || product.name,
								description: match.description || product.description,
								intensity: match.intensity ?? product.intensity,
								priceRon: typeof match.price === "number" ? match.price : product.priceRon,
								priceClass: match.priceClass || product.priceClass,
								image: buildImagePath(match),
								imageScale: imageScale ?? product.imageScale,
								imageOffsetY: imageOffsetY ?? product.imageOffsetY,
								notes: Array.isArray(match.notes) && match.notes.length ? match.notes : product.notes,
								servings:
									Array.isArray(match.servings) && match.servings.length
										? match.servings.map((serving) => ({
												icon: `/${serving.icon.replace(/^\/+/g, "")}`,
												title: serving.title,
												volume: serving.volume,
											}))
										: product.servings,
								unitLabel: product.unitLabel || "1 sleeve (10 capsules)",
								unitCount: product.unitCount || 10,
							};
						}),
					}));

					// Append any API-only products not present in static collections
					const leftover: ApiProduct[] = [];
					for (const p of map.values()) if (!matchedIds.has(p.productId)) leftover.push(p);
					if (leftover.length) {
						const extrasByGroup = new Map<number, ReturnType<typeof convertToCoffeeProduct>[]>();
						const orphans: ReturnType<typeof convertToCoffeeProduct>[] = [];
						for (const p of leftover) {
							const key = normalizeKey(p.category || "");
							const idx = groupTitleIndex.get(key);
							const converted = convertToCoffeeProduct(p);
							if (idx !== undefined) {
								const bucket = extrasByGroup.get(idx) || [];
								bucket.push(converted);
								extrasByGroup.set(idx, bucket);
							} else {
								orphans.push(converted);
							}
						}

						extrasByGroup.forEach((items, idx) => {
							groups[idx] = {
								...groups[idx],
								products: [...groups[idx].products, ...items],
							};
						});

						if (orphans.length) {
							groups.push({
								title: "Other",
								description: "Added from API",
								products: orphans,
							});
						}
					}

					return { ...collection, groups };
				});

				if (!cancelled) {
					setCollections(merged);
					setStockData(buildStockMap(products));
					setError(data.error);
				}
			} catch (err: unknown) {
				if (!cancelled) {
					const message = err instanceof Error ? err.message : "Failed to load coffee collections";
					setError(message);
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

	// keep memo for stable reference in consumers
	const memoCollections = useMemo(() => collections, [collections]);
	const memoStockData = useMemo(() => stockData, [stockData]);
	return { collections: memoCollections, stockData: memoStockData, loading, error };
}
