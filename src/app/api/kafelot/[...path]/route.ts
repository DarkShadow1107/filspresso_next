import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function backendPath(params: Promise<{ path?: string[] }>) {
	const { path = [] } = await params;
	return `/api/kafelot/${path.map(encodeURIComponent).join("/")}`;
}

function statusFallback(request: NextRequest) {
	const scope = request.nextUrl.searchParams.get("scope") === "molecule_helper" ? "molecule_helper" : "general";
	return NextResponse.json(
		{
			prompts_remaining: scope === "molecule_helper" ? 25 : 25,
			prompts_limit: scope === "molecule_helper" ? 25 : 25,
			reset_date: null,
			tier: "free",
			scope,
			source: "static-fallback",
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	const path = await backendPath(context.params);
	return proxyBackendRequest(request, path, {
		timeoutMs: 4500,
		fallback: path.endsWith("/status") ? () => statusFallback(request) : undefined,
	});
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	return proxyBackendRequest(request, await backendPath(context.params), { timeoutMs: 5000 });
}
