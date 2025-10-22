import { NextResponse } from "next/server";

export async function POST(request: Request) {
	try {
		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const body = (await request.json()) as Record<string, unknown>;
		const res = await fetch(`${PY_HOST}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: (body.model as string) || "tanka",
				message: ((body.messages as Array<Record<string, string>>) || [])
					.map((m: Record<string, string>) => m.content)
					.join("\n"),
				history: [],
			}),
		});
		const json = (await res.json()) as Record<string, unknown>;
		// Normalize Python response shape to what frontend expects and indicate smarter AI is active
		return NextResponse.json(
			{
				response: (json.assistant_response as string) || (json.generated as string) || "",
				products: (json.products as unknown[]) || [],
				smarterAI: true,
			},
			{ status: res.status }
		);
	} catch (err) {
		return NextResponse.json({ error: String(err) }, { status: 502 });
	}
}
