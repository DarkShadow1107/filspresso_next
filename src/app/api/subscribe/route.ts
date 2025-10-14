import { NextResponse } from "next/server";

export async function POST(req: Request) {
	try {
		const body = await req.json();
		const email = typeof body.email === "string" ? body.email : null;
		if (!email) return NextResponse.json({ ok: false, message: "email required" }, { status: 400 });
		// Here you'd save the email to a database or mailing list.
		return NextResponse.json({ ok: true, message: `subscribed ${email}` });
	} catch {
		return NextResponse.json({ ok: false, message: "invalid payload" }, { status: 400 });
	}
}
