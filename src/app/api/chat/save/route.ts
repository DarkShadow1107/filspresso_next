import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATA_FILE_PATH = path.join(process.cwd(), "src", "data", "chat_history.json");
let latestPendingHistory: unknown = null;
let writeLoopPromise: Promise<void> | null = null;

async function flushLatestHistory() {
	if (writeLoopPromise) {
		await writeLoopPromise;
		return;
	}

	writeLoopPromise = (async () => {
		while (latestPendingHistory !== null) {
			const snapshot = latestPendingHistory;
			latestPendingHistory = null;

			const dir = path.dirname(DATA_FILE_PATH);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			const serialized = JSON.stringify(snapshot, null, 2);
			const tmpFile = `${DATA_FILE_PATH}.tmp`;
			await fs.promises.writeFile(tmpFile, serialized, "utf-8");
			await fs.promises.rename(tmpFile, DATA_FILE_PATH);
		}
	})();

	try {
		await writeLoopPromise;
	} finally {
		writeLoopPromise = null;
	}
}

export async function POST(req: Request) {
	try {
		const body = await req.json();
		const { history } = body;

		if (!history) {
			return NextResponse.json({ error: "No history provided" }, { status: 400 });
		}

		latestPendingHistory = history;
		await flushLatestHistory();

		return NextResponse.json(
			{ success: true },
			{
				headers: {
					"Cache-Control": "no-store",
				},
			},
		);
	} catch (error) {
		console.error("Error saving chat history:", error);
		return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
	}
}

export async function GET() {
	try {
		if (fs.existsSync(DATA_FILE_PATH)) {
			const fileContent = await fs.promises.readFile(DATA_FILE_PATH, "utf-8");
			const history = JSON.parse(fileContent);
			return NextResponse.json(
				{ history },
				{
					headers: {
						"Cache-Control": "no-store",
					},
				},
			);
		}
		return NextResponse.json(
			{ history: [] },
			{
				headers: {
					"Cache-Control": "no-store",
				},
			},
		);
	} catch (error) {
		console.error("Error reading chat history:", error);
		return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
	}
}
