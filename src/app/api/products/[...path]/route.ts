import { NextRequest, NextResponse } from "next/server";
import { coffeeCollections } from "@/data/coffee";
import { machineCollections } from "@/data/machines";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductKind = "coffee" | "machines";

function stockStatus(stock: number, lowWatermark: number) {
	if (stock <= 0) return "out_of_stock";
	if (stock < lowWatermark) return "low_stock";
	return "in_stock";
}

function fallbackCoffeeProducts() {
	return coffeeCollections.flatMap((collection) => {
		const productType = collection.id === "vertuo" ? "vertuo" : "original";
		return collection.groups.flatMap((group) =>
			group.products.map((product) => {
				const stock = 100;
				return {
					productId: product.id,
					productType,
					category: group.title,
					name: product.name,
					description: product.description,
					notes: product.notes ?? [],
					servings: product.servings,
					intensity: product.intensity ?? null,
					price: product.priceRon,
					priceRon: product.priceRon,
					image: product.image,
					priceClass: product.priceClass ?? null,
					stock,
					stockStatus: stockStatus(stock, 40),
				};
			}),
		);
	});
}

function fallbackMachineProducts() {
	return machineCollections.flatMap((collection) => {
		const productType = collection.id === "vertuo" ? "vertuo" : "original";
		return collection.groups.flatMap((group) =>
			group.products.map((product) => {
				const stock = 12;
				return {
					productId: product.id,
					productType,
					category: group.title,
					name: product.name,
					description: product.description,
					notes: product.notes ?? [],
					image: product.image,
					boxClass: product.boxClass ?? null,
					wrapperClass: product.wrapperClass ?? null,
					unitLabel: product.unitLabel,
					priceClass: product.priceClass ?? null,
					extraClass: product.extraClass ?? [],
					price: product.priceRon,
					priceRon: product.priceRon,
					stock,
					stockStatus: stockStatus(stock, 4),
				};
			}),
		);
	});
}

function fallbackProducts(kind: ProductKind) {
	const products = kind === "coffee" ? fallbackCoffeeProducts() : fallbackMachineProducts();
	return NextResponse.json(
		{ products, source: "static-fallback" },
		{
			headers: {
				"Cache-Control": "public, max-age=30, stale-while-revalidate=300",
			},
		},
	);
}

async function productKind(params: Promise<{ path?: string[] }>): Promise<ProductKind | null> {
	const { path = [] } = await params;
	const kind = path[0];
	return kind === "coffee" || kind === "machines" ? kind : null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	const { path = [] } = await context.params;
	const kind = await productKind(context.params);
	const backendPath = `/api/products/${path.map(encodeURIComponent).join("/")}`;
	const cacheHeaders =
		kind === "coffee" || kind === "machines"
			? {
					"Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=1800",
			  }
			: undefined;

	return proxyBackendRequest(request, backendPath, {
		timeoutMs: 1800,
		fallback: kind ? () => fallbackProducts(kind) : undefined,
		responseHeaders: cacheHeaders,
	});
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	const { path = [] } = await context.params;
	return proxyBackendRequest(request, `/api/products/${path.map(encodeURIComponent).join("/")}`, { timeoutMs: 5000 });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	const { path = [] } = await context.params;
	return proxyBackendRequest(request, `/api/products/${path.map(encodeURIComponent).join("/")}`, { timeoutMs: 5000 });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	const { path = [] } = await context.params;
	return proxyBackendRequest(request, `/api/products/${path.map(encodeURIComponent).join("/")}`, { timeoutMs: 5000 });
}
