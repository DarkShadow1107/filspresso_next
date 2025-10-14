import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const coffeeJsonPath = path.join(__dirname, "..", "src", "data", "coffee.generated.json");

const diacriticless = (str) => str.normalize("NFD").replace(/\p{Diacritic}+/gu, "");
const toTitleCase = (word) => {
	if (!word) return word;
	const [first, ...rest] = word;
	const head = first.toLocaleUpperCase("fr-FR");
	const tail = rest.join("").toLocaleLowerCase("fr-FR");
	return `${head}${tail}`;
};

const stopWords = new Set(
	[
		"un",
		"une",
		"de",
		"des",
		"du",
		"le",
		"la",
		"les",
		"au",
		"aux",
		"avec",
		"pour",
		"dans",
		"sur",
		"et",
		"en",
		"par",
		"que",
		"qui",
		"qu",
		"cette",
		"ce",
		"cet",
		"ces",
		"nos",
		"vos",
		"leurs",
		"notes",
		"note",
		"arome",
		"aromes",
		"arôme",
		"arômes",
		"gout",
		"goût",
		"saveur",
		"saveurs",
		"caf",
		"cafe",
		"café",
		"espresso",
		"capsules",
		"capsule",
		"coffee",
		"flavor",
		"flavour",
		"flavours",
		"taste",
		"from",
		"the",
		"and",
		"with",
		"this",
		"that",
		"into",
		"its",
		"their",
		"his",
		"her",
		"your",
		"our",
		"de",
		"d",
		"l",
		"la",
		"le",
	].map((word) => diacriticless(word).toLowerCase())
);

const raw = fs.readFileSync(coffeeJsonPath, "utf8");
const data = JSON.parse(raw);
let modifiedCount = 0;

const maxNotes = 4;

const extractNotes = (description) => {
	if (!description) return [];
	const words = description.match(/\p{L}+/gu);
	if (!words) return [];
	const selected = [];
	const seen = new Set();
	for (const rawWord of words) {
		const normalized = diacriticless(rawWord).toLowerCase();
		if (normalized.length < 3) continue;
		if (stopWords.has(normalized)) continue;
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		selected.push(toTitleCase(rawWord));
		if (selected.length >= maxNotes) break;
	}
	return selected;
};

for (const collection of data) {
	for (const group of collection.groups) {
		for (const product of group.products) {
			if (Array.isArray(product.additionalDescriptions) && product.additionalDescriptions.length) {
				// ensure they are single words (trim if needed)
				product.additionalDescriptions = product.additionalDescriptions.map((word) => {
					const cleaned = word.trim();
					return cleaned.includes(" ") ? cleaned.split(/\s+/)[0] : cleaned;
				});
				continue;
			}
			const notes = extractNotes(product.description);
			if (notes.length) {
				product.additionalDescriptions = notes;
				modifiedCount += 1;
			}
		}
	}
}

fs.writeFileSync(coffeeJsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

console.log(`Updated notes for ${modifiedCount} products in ${coffeeJsonPath}`);
