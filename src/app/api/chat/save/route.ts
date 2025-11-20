import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_FILE_PATH = path.join(process.cwd(), "src", "data", "chat_history.json");

export async function POST(req: Request) {
	try {
		const body = await req.json();
		const { history } = body;

		if (!history) {
			return NextResponse.json({ error: "No history provided" }, { status: 400 });
		}

		// Ensure directory exists
		const dir = path.dirname(DATA_FILE_PATH);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		// Write to file
		fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(history, null, 2));

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error saving chat history:", error);
		return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
	}
}

export async function GET() {
	try {
		if (fs.existsSync(DATA_FILE_PATH)) {
			const fileContent = fs.readFileSync(DATA_FILE_PATH, "utf-8");
			const history = JSON.parse(fileContent);
			return NextResponse.json({ history });
		}
		return NextResponse.json({ history: [] });
	} catch (error) {
		console.error("Error reading chat history:", error);
		return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
	}
}
