import { NextResponse } from "next/server";

export async function POST(req: Request) {
	try {
		const body = await req.json();
		// Minimal server-side handling: validate and echo back
		const name = typeof body.name === "string" ? body.name : "guest";
		// In a real app you'd integrate payment and order storage here.
		return NextResponse.json({ ok: true, message: `order received for ${name}` });
	} catch {
		return NextResponse.json({ ok: false, message: "invalid payload" }, { status: 400 });
	}
}
