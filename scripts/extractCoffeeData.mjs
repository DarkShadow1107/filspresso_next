import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const legacyCoffeePath = path.join(rootDir, "deprecated", "coffee.html");
const outputPath = path.join(rootDir, "src", "data", "coffee.generated.json");

function parsePrice(text) {
	if (!text) return null;
	const match = text.match(/([0-9]+(?:,[0-9]+)?)/);
	if (!match) return null;
	return parseFloat(match[1].replace(",", "."));
}

function parseUnitCount(label) {
	if (!label) return undefined;
	const match = label.match(/(\d+)(?=\s*capsules?)/i);
	if (match) return Number(match[1]);
	return undefined;
}

const html = fs.readFileSync(legacyCoffeePath, "utf8");
const $ = load(html);

function normalizeText(text) {
	return text.replace(/\s+/g, " ").trim();
}

function extractCollections() {
	const sections = [];
	$("div.original, div.vertuo").each((_, sectionEl) => {
		const section = $(sectionEl);
		const heading = section.find("h2").first();
		const id = heading.attr("id")?.trim() || normalizeText(heading.text()).toLowerCase();
		const title = normalizeText(heading.text());
		const groups = [];

		section.children("div.coffee_groups").each((__, groupEl) => {
			const group = $(groupEl);
			const header = group.find(".coffee_groups_head, .machine_groups_head, .machine_groups_head_2").first();
			const groupTitle = normalizeText(header.find("strong").first().text());
			const dimmer = normalizeText(header.find(".text_dimmer").text());
			const description = normalizeText(header.find(".text_head").text());
			const products = [];

			group.find(".coffee_groups_capsules, .machine_groups_models, .machine_groups_models_2").each((___, productEl) => {
				const product = $(productEl);
				const imageEl = product.find(".capsule_box img, .machine_box img, .machine_box_2 img").first();
				const image = imageEl.attr("src") || "";
				const name = normalizeText(product.find("h3.h3_capsule").first().text());
				const descriptionPrimary = normalizeText(product.find(".text_capsule").first().text());
				const descriptionSecondary = product
					.find(".text_capsule_2")
					.map((____, el) => normalizeText($(el).text()))
					.get()
					.filter(Boolean);
				const servings = product
					.find(".box_coffee_type")
					.map((_____, serveEl) => {
						const serve = $(serveEl);
						const icon = serve.find("img").attr("src") || "";
						const title = serve.attr("title")
							? normalizeText(serve.attr("title"))
							: normalizeText(serve.find("img").attr("title") || "");
						const volume = normalizeText(serve.find(".text_coffee_made").text());
						return { icon, title, volume };
					})
					.get();
				const intensityValue = parseInt(product.find(".intensity strong").first().text(), 10);
				const priceWrapper = product.find("[id='parentDiv'], [id='parentDiv2']").first();
				const priceClass = priceWrapper.attr("class")?.trim();
				const priceText = normalizeText(priceWrapper.find("#sourceDiv, #sourceDiv2").first().text());
				const priceRon = parsePrice(priceText);
				const unitLabel = normalizeText(priceWrapper.find(".price_per_capsule, .price_per_capsule_1").first().text());
				const unitCount = parseUnitCount(unitLabel);
				const notes = descriptionSecondary.length > 0 ? descriptionSecondary : undefined;

				const extraClass = product
					.attr("class")
					?.split(/\s+/)
					.filter(
						(cls) => !["coffee_groups_capsules", "machine_groups_models", "machine_groups_models_2"].includes(cls)
					);
				const imageStyle = imageEl.attr("style") || "";

				products.push({
					id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
					name,
					description: descriptionPrimary,
					additionalDescriptions: notes,
					image,
					imageStyle,
					servings,
					intensity: Number.isFinite(intensityValue) ? intensityValue : null,
					priceText,
					priceRon,
					unitLabel,
					unitCount,
					priceClass,
					extraClass,
				});
			});

			groups.push({
				title: groupTitle,
				dimmer,
				description,
				products,
			});
		});

		sections.push({ id, title, groups });
	});

	return sections;
}

const collections = extractCollections();

fs.writeFileSync(outputPath, JSON.stringify(collections, null, 2), "utf8");

console.log(`Extracted ${collections.length} collections to ${outputPath}`);
