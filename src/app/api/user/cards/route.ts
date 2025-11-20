import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DATA_FILE_PATH = path.join(process.cwd(), "src", "data", "user_cards.json");

type CardData = {
	id: string;
	cardNumber: string;
	expiry: string;
	cvv: string;
	cardType: string;
	cardHolder: string;
	createdAt: number;
};

async function readCards(): Promise<CardData[]> {
	try {
		const data = await fs.readFile(DATA_FILE_PATH, "utf-8");
		return JSON.parse(data);
	} catch (error) {
		// If file doesn't exist or is invalid, return empty array
		return [];
	}
}

async function writeCards(cards: CardData[]) {
	await fs.writeFile(DATA_FILE_PATH, JSON.stringify(cards, null, 2), "utf-8");
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const id = searchParams.get("id");
	const showFull = searchParams.get("showFull") === "true";

	const cards = await readCards();

	if (id && showFull) {
		const card = cards.find((c) => c.id === id);
		if (!card) {
			return NextResponse.json({ error: "Card not found" }, { status: 404 });
		}
		// Return full details for autofill
		return NextResponse.json(card);
	}

	// Return masked data for the list
	const maskedCards = cards.map((card) => ({
		id: card.id,
		last4: card.cardNumber.slice(-4),
		expiry: card.expiry,
		cardType: card.cardType,
		cardHolder: card.cardHolder,
		// We don't send full number or CVV in the list
	}));
	return NextResponse.json(maskedCards);
}

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const { cardNumber, expiry, cvv, cardType, cardHolder } = body;

		if (!cardNumber || !expiry || !cvv || !cardType) {
			return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
		}

		const cards = await readCards();

		// Simple duplicate check based on card number
		const existing = cards.find((c) => c.cardNumber === cardNumber);
		if (existing) {
			return NextResponse.json({ error: "Card already saved" }, { status: 409 });
		}

		const newCard: CardData = {
			id: crypto.randomUUID(),
			cardNumber,
			expiry,
			cvv,
			cardType,
			cardHolder: cardHolder || "",
			createdAt: Date.now(),
		};

		cards.push(newCard);
		await writeCards(cards);

		return NextResponse.json({
			success: true,
			card: {
				id: newCard.id,
				last4: newCard.cardNumber.slice(-4),
				expiry: newCard.expiry,
				cardType: newCard.cardType,
				cardHolder: newCard.cardHolder,
			},
		});
	} catch (error) {
		console.error("Error saving card:", error);
		return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
	}
}

export async function DELETE(request: Request) {
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get("id");

		if (!id) {
			return NextResponse.json({ error: "Missing card ID" }, { status: 400 });
		}

		const cards = await readCards();
		const filteredCards = cards.filter((card) => card.id !== id);

		if (cards.length === filteredCards.length) {
			return NextResponse.json({ error: "Card not found" }, { status: 404 });
		}

		await writeCards(filteredCards);

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error deleting card:", error);
		return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
	}
}
