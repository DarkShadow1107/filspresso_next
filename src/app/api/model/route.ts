import { NextResponse } from "next/server";

/**
 * This route is deprecated. The Gemma model is now served directly from
 * public/models/gemma3-1b-it-int4-web.task via Next.js static assets.
 *
 * The model is loaded client-side via: /models/gemma3-1b-it-int4-web.task
 */

export async function GET() {
	return new NextResponse("Model is served from /models/gemma3-1b-it-int4-web.task (public folder)", {
		status: 200,
		headers: { "Content-Type": "text/plain" },
	});
}
