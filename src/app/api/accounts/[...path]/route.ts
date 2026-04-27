import { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function backendPath(params: Promise<{ path?: string[] }>) {
	const { path = [] } = await params;
	return `/api/accounts/${path.map(encodeURIComponent).join("/")}`;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	return proxyBackendRequest(request, await backendPath(context.params), { timeoutMs: 1800 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	return proxyBackendRequest(request, await backendPath(context.params), { timeoutMs: 6000 });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
	return proxyBackendRequest(request, await backendPath(context.params), { timeoutMs: 6000 });
}
