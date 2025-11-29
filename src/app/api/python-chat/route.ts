import { NextResponse } from "next/server";

export async function POST(request: Request) {
	try {
		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const body = (await request.json()) as Record<string, unknown>;

		// Generate a unique request ID for cancellation support
		const requestId = (body.request_id as string) || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const res = await fetch(`${PY_HOST}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: (body.model as string) || "tanka",
				message: ((body.messages as Array<Record<string, string>>) || [])
					.map((m: Record<string, string>) => m.content)
					.join("\n"),
				history: [],
				request_id: requestId,
				subscription: body.subscription,
				chemistry_mode: body.chemistry_mode,
			}),
		});
		const json = (await res.json()) as Record<string, unknown>;

		// Check if request was cancelled
		if (json.cancelled) {
			return NextResponse.json({ cancelled: true, request_id: requestId }, { status: 200 });
		}

		// Normalize Python response shape to what frontend expects and indicate smarter AI is active
		return NextResponse.json(
			{
				response: (json.assistant_response as string) || (json.generated as string) || "",
				products: (json.products as unknown[]) || [],
				smarterAI: true,
				request_id: requestId,
			},
			{ status: res.status }
		);
	} catch (err) {
		return NextResponse.json({ error: String(err) }, { status: 502 });
	}
}

// Cancel endpoint
export async function DELETE(request: Request) {
	try {
		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const { searchParams } = new URL(request.url);
		const requestId = searchParams.get("request_id");

		if (!requestId) {
			return NextResponse.json({ error: "request_id is required" }, { status: 400 });
		}

		const res = await fetch(`${PY_HOST}/api/cancel/${requestId}`, {
			method: "POST",
		});
		const json = await res.json();

		return NextResponse.json(json, { status: res.status });
	} catch (err) {
		return NextResponse.json({ error: String(err) }, { status: 502 });
	}
}
