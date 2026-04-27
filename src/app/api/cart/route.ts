import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const emptyCart = () =>
	NextResponse.json(
		{
			items: [],
			subtotal: 0,
			subtotalAfterDiscount: 0,
			memberTier: "None",
			discountPercent: 0,
			discountAmount: 0,
			source: "static-fallback",
		},
		{ headers: { "Cache-Control": "no-store" } },
	);

export async function GET(request: NextRequest) {
	return proxyBackendRequest(request, "/api/cart", { timeoutMs: 1800, fallback: emptyCart });
}

export async function POST(request: NextRequest) {
	return proxyBackendRequest(request, "/api/cart", { timeoutMs: 6000 });
}

export async function DELETE(request: NextRequest) {
	return proxyBackendRequest(request, "/api/cart", { timeoutMs: 6000 });
}
