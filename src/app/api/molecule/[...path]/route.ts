import { NextResponse } from "next/server";

const PY_HOST = process.env.PYTHON_AI_HOST || "http://localhost:5000";
const MOLECULE_PROXY_TIMEOUT_MS = Math.max(3_000, Number.parseInt(process.env.MOLECULE_API_TIMEOUT_MS || "15000", 10) || 15_000);

type RouteContext = {
	params: Promise<{ path: string[] }>;
};

async function forwardMoleculeRequest(request: Request, context: RouteContext, method: string) {
	const { path } = await context.params;
	if (!Array.isArray(path) || path.length === 0) {
		return NextResponse.json({ error: "Molecule route not found" }, { status: 404 });
	}

	const upstreamUrl = new URL(`${PY_HOST}/api/molecule/${path.join("/")}`);
	const incomingUrl = new URL(request.url);
	upstreamUrl.search = incomingUrl.search;

	const headers = new Headers();
	const accept = request.headers.get("accept");
	if (accept) {
		headers.set("Accept", accept);
	}

	const contentType = request.headers.get("content-type");
	if (contentType) {
		headers.set("Content-Type", contentType);
	}

	const body = method === "GET" || method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());

	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), MOLECULE_PROXY_TIMEOUT_MS);

	let backendResponse: Response;
	try {
		backendResponse = await fetch(upstreamUrl, {
			method,
			headers,
			body,
			cache: "no-store",
			signal: abortController.signal,
		});
	} catch (error) {
		const isAbortError =
			error instanceof Error && (error.name === "AbortError" || /timeout|headers timeout/i.test(error.message));
		return NextResponse.json(
			{
				error: isAbortError ? "MOLECULE_API_TIMEOUT" : "MOLECULE_API_UNAVAILABLE",
				message: isAbortError
					? "Molecule service timed out. Please try again."
					: "Molecule service is temporarily unavailable.",
			},
			{ status: isAbortError ? 504 : 502 },
		);
	} finally {
		clearTimeout(timeout);
	}

	const responseHeaders = new Headers();
	const upstreamContentType = backendResponse.headers.get("content-type");
	if (upstreamContentType) {
		responseHeaders.set("Content-Type", upstreamContentType);
	}

	return new NextResponse(backendResponse.body, {
		status: backendResponse.status,
		headers: responseHeaders,
	});
}

export async function GET(request: Request, context: RouteContext) {
	return forwardMoleculeRequest(request, context, "GET");
}

export async function POST(request: Request, context: RouteContext) {
	return forwardMoleculeRequest(request, context, "POST");
}

export async function PUT(request: Request, context: RouteContext) {
	return forwardMoleculeRequest(request, context, "PUT");
}

export async function DELETE(request: Request, context: RouteContext) {
	return forwardMoleculeRequest(request, context, "DELETE");
}
