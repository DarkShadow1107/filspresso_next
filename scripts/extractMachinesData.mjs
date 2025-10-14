import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const legacyMachinesPath = path.join(rootDir, "deprecated", "machines.html");
const outputPath = path.join(rootDir, "src", "data", "machines.generated.json");

function parsePrice(text) {
	if (!text) return null;
	const match = text.match(/([0-9]+(?:,[0-9]+)?)/);
	if (!match) return null;
	return parseFloat(match[1].replace(",", "."));
}

const html = fs.readFileSync(legacyMachinesPath, "utf8");
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

		section.children("div.machine_groups").each((__, groupEl) => {
			const group = $(groupEl);
			const header = group.find(".machine_groups_head, .machine_groups_head_2").first();
			const groupTitle = normalizeText(header.find("strong").first().text());
			const description = normalizeText(header.find(".text_head").text());
			const headerClass = header.attr("class")?.trim();
			const products = [];

			group.find(".machine_groups_models, .machine_groups_models_2").each((___, productEl) => {
				const product = $(productEl);
				const wrapperClass = product
					.attr("class")
					?.split(/\s+/)
					.find((cls) => cls === "machine_groups_models" || cls === "machine_groups_models_2");
				const imageEl = product.find("img").first();
				const image = imageEl.attr("src") || "";
				const boxClass = product.find(".machine_box, .machine_box_2").first().attr("class")?.trim();
				const name = normalizeText(product.find("h3.h3_capsule").first().text());
				const descriptionPrimary = normalizeText(product.find(".text_capsule").first().text());
				const descriptionSecondary = product
					.find(".text_capsule_2")
					.map((____, el) => normalizeText($(el).text()))
					.get()
					.filter(Boolean);
				const priceWrapper = product.find("[id='parentDiv2']").first();
				const priceClass = priceWrapper.attr("class")?.trim();
				const priceText = normalizeText(priceWrapper.find("#sourceDiv2").first().text());
				const priceRon = parsePrice(priceText);
				const unitLabel = normalizeText(priceWrapper.find(".price_per_capsule").first().text());

				const extraClass = product
					.attr("class")
					?.split(/\s+/)
					.filter((cls) => !["machine_groups_models", "machine_groups_models_2"].includes(cls));

				products.push({
					id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
					name,
					description: descriptionPrimary,
					notes: descriptionSecondary,
					image,
					boxClass,
					wrapperClass,
					priceText,
					priceRon,
					unitLabel,
					priceClass,
					extraClass,
				});
			});

			groups.push({
				title: groupTitle,
				description,
				headerClass,
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
