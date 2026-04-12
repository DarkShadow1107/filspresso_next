import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Simple proxy to the Python AI health endpoint (assumes Python AI runs on localhost:5000)
export async function GET() {
	try {
		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const res = await fetch(`${PY_HOST}/api/health`, { cache: "no-store" });
		const json = await res.json();
		return NextResponse.json(json, {
			status: res.status,
			headers: {
				"Cache-Control": "no-store",
			},
		});
	} catch (err) {
		return NextResponse.json({ status: "error", error: String(err) }, { status: 502 });
	}
}
