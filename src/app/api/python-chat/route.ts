import { NextResponse } from "next/server";

export async function POST(request: Request) {
	try {
		const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
		const contentType = request.headers.get("content-type") || "";

		// Generate a unique request ID for cancellation support
		const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		let pyBody: BodyInit;
		let pyHeaders: Record<string, string> = {};
		let modelType = "tanka_semantic";

		if (contentType.includes("multipart/form-data")) {
			// Image upload path — forward FormData to Python
			const formData = await request.formData();
			const image = formData.get("image") as File | null;
			const messagesRaw = formData.get("messages") as string;
			const messages = messagesRaw ? (JSON.parse(messagesRaw) as Array<Record<string, string>>) : [];

			modelType = (formData.get("model") as string) || "tanka_semantic";
			const mode = modelType === "tanka_chemistry" ? "chemistry" : "natural_language";
			const reqId = (formData.get("request_id") as string) || requestId;

			// Only use the last user message for semantic embedding — joining full history produces a noisy vector
			const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
			const queryMessage = lastUserMsg?.content || messages[messages.length - 1]?.content || "";

			const pyForm = new FormData();
			pyForm.append("message", queryMessage);
			pyForm.append("mode", mode);
			pyForm.append("request_id", reqId);
			if (image) pyForm.append("image", image);

			pyBody = pyForm;
		} else {
			// Text-only JSON path
			const body = (await request.json()) as Record<string, unknown>;
			modelType = (body.model as string) || "tanka_semantic";
			const mode = modelType === "tanka_chemistry" ? "chemistry" : "natural_language";
			const reqId = (body.request_id as string) || requestId;

			pyHeaders = { "Content-Type": "application/json" };
			// Only use the last user message for semantic embedding — joining full history produces a noisy vector
			const msgList = (body.messages as Array<Record<string, string>>) || [];
			const lastUserContent =
				[...msgList].reverse().find((m) => m.role === "user")?.content || msgList[msgList.length - 1]?.content || "";
			pyBody = JSON.stringify({
				message: lastUserContent,
				mode,
				request_id: reqId,
			});
		}

		const res = await fetch(`${PY_HOST}/api/chat`, {
			method: "POST",
			headers: pyHeaders,
			body: pyBody,
		});

		if (!res.ok) {
			const text = await res.text();
			let errorMsg = `Python AI error: ${res.status}`;
			try {
				const errorJson = JSON.parse(text);
				errorMsg = errorJson.error || errorMsg;
			} catch {
				// Not JSON, keep status message
			}
			return NextResponse.json({ error: errorMsg }, { status: res.status });
		}

		const json = (await res.json()) as Record<string, unknown>;

		// Check if request was cancelled
		if (json.cancelled) {
			return NextResponse.json({ cancelled: true, request_id: requestId }, { status: 200 });
		}

		// Normalize Python response shape to what frontend expects
		return NextResponse.json(
			{
				response: (json.assistant_response as string) || (json.generated as string) || "",
				products: (json.products as unknown[]) || [],
				smarterAI: true,
				model: "Tanka",
				mode: (json.mode as string) || "",
				request_id: requestId,
			},
			{ status: res.status },
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
