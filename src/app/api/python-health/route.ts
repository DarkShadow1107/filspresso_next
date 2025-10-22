import { NextResponse } from "next/server";

// Simple proxy to the Python AI health endpoint (assumes Python AI runs on localhost:5000)
export async function GET() {
	try {
		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const res = await fetch(`${PY_HOST}/api/health`);
		const json = await res.json();
		return NextResponse.json(json, { status: res.status });
	} catch (err) {
		return NextResponse.json({ status: "error", error: String(err) }, { status: 502 });
	}
}
