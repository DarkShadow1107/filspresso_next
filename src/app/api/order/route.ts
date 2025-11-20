import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DATA_FILE_PATH = path.join(process.cwd(), "src", "data", "orders.json");

type OrderItem = {
	id: string;
	name: string;
	price: number;
	qty: number;
	image?: string;
};

type Order = {
	id: string;
	username: string;
	items: OrderItem[];
	total: number;
	date: number;
	status: string;
	paymentMethod: string;
};

async function readOrders(): Promise<Order[]> {
	try {
		const data = await fs.readFile(DATA_FILE_PATH, "utf-8");
		return JSON.parse(data);
	} catch (error) {
		return [];
	}
}

async function writeOrders(orders: Order[]) {
	await fs.writeFile(DATA_FILE_PATH, JSON.stringify(orders, null, 2), "utf-8");
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const username = searchParams.get("username");

	if (!username) {
		return NextResponse.json({ error: "Username required" }, { status: 400 });
	}

	const orders = await readOrders();
	const userOrders = orders.filter((o) => o.username === username);

	// Sort by date descending
	userOrders.sort((a, b) => b.date - a.date);

	return NextResponse.json(userOrders);
}

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const { username, items, total, paymentMethod } = body;

		if (!username || !items || !total) {
			return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
		}

		const orders = await readOrders();

		const newOrder: Order = {
			id: crypto.randomUUID(),
			username,
			items,
			total,
			date: Date.now(),
			status: "Paid",
			paymentMethod: paymentMethod || "Card",
		};

		orders.push(newOrder);
		await writeOrders(orders);

		return NextResponse.json({ success: true, order: newOrder });
	} catch (error) {
		console.error("Error saving order:", error);
		return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
	}
}
