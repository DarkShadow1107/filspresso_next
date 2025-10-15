export type CoffeeServing = {
	title: string;
	volume: string;
	icon: string;
};

export type CoffeeProduct = {
	id: string;
	name: string;
	description: string;
	image: string;
	imageScale?: number;
	imageOffsetY?: number;
	intensity?: number;
	intensityScale?: number;
	priceRon: number;
	unitLabel: string;
	unitCount?: number;
	servings: CoffeeServing[];
	priceClass?: string;
	notes?: string[];
	extraClass?: string[];
};

export type CoffeeGroup = {
	title: string;
	description: string;
	dimmer?: string;
	products: CoffeeProduct[];
	headerClass?: string;
};

export type CoffeeCollection = {
	id: string;
	title: string;
	headline: string;
	groups: CoffeeGroup[];
};

type RawServing = {
	icon: string;
	title: string;
	volume: string;
};

type RawProduct = {
	id: string;
	name: string;
	description: string;
	additionalDescriptions?: string[];
	image: string;
	imageStyle?: string;
	servings: RawServing[];
	intensity: number | null;
	priceText?: string;
	priceRon: number | null;
	unitLabel: string;
	unitCount?: number;
	priceClass?: string;
	extraClass?: string[];
};

type RawGroup = {
	title: string;
	dimmer?: string;
	description?: string;
	products: RawProduct[];
};

type RawCollection = {
	id: string;
	title: string;
	groups: RawGroup[];
};

import rawCollectionsJson from "./coffee.generated.json" assert { type: "json" };

const rawCollections = rawCollectionsJson as RawCollection[];

function parseImageStyle(style?: string) {
	if (!style) return {} as { imageScale?: number; imageOffsetY?: number };
	const parts = style
		.split(";")
		.map((p) => p.trim())
		.filter(Boolean);
	const result: { imageScale?: number; imageOffsetY?: number } = {};
	for (const part of parts) {
		const [prop, value] = part.split(":").map((p) => p.trim());
		if (!prop || !value) continue;
		if (prop === "scale") {
			const num = Number(value.replace(/[^0-9.\-]/g, ""));
			if (!Number.isNaN(num)) result.imageScale = num;
		} else if (prop === "margin-top") {
			const num = Number(value.replace(/[^0-9.\-]/g, ""));
			if (!Number.isNaN(num)) result.imageOffsetY = num;
		}
	}
	return result;
}

function generateNotesFromDescription(description?: string) {
	if (!description) return undefined;
	// simple heuristics: split on commas and 'avec'/'and' to produce short note chips
	const parts = description
		.split(/,|\bavec\b|\band\b/i)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => {
			// sentence-case and remove trailing periods
			const normalized = p.replace(/\.$/, "").trim();
			return normalized.charAt(0).toUpperCase() + normalized.slice(1);
		});
	// collapse to unique short notes and limit to 6
	const uniq = Array.from(new Set(parts)).slice(0, 6);
	return uniq.length ? uniq : undefined;
}

export const coffeeCollections: CoffeeCollection[] = rawCollections.map((collection) => {
	return {
		id: collection.id,
		title: collection.title,
		headline: collection.title,
		groups: collection.groups.map((group) => ({
			title: group.title,
			description: group.description ?? "",
			dimmer: group.dimmer,
			products: group.products.map((product) => {
				const { imageScale, imageOffsetY } = parseImageStyle(product.imageStyle);
				const generatedNotes = generateNotesFromDescription(product.description);
				return {
					id: product.id,
					name: product.name,
					description: product.description,
					notes: product.additionalDescriptions ?? generatedNotes,
					image: `/${product.image.replace(/^\/+/, "")}`,
					imageScale,
					imageOffsetY,
					servings: product.servings.map((serving) => ({
						icon: `/${serving.icon.replace(/^\/+/, "")}`,
						title: serving.title,
						volume: serving.volume,
					})),
					intensity: product.intensity ?? undefined,
					intensityScale: 13,
					priceRon: product.priceRon ?? 0,
					unitLabel: product.unitLabel,
					unitCount: product.unitCount,
					priceClass: product.priceClass,
					extraClass: product.extraClass?.length ? product.extraClass : undefined,
				};
			}),
		})),
	};
});
