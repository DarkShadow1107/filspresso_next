export type MachineProduct = {
	id: string;
	name: string;
	description: string;
	notes?: string[];
	image: string;
	boxClass?: string;
	wrapperClass?: string;
	priceRon: number;
	unitLabel: string;
	priceClass?: string;
	extraClass?: string[];
};

export type MachineGroup = {
	title: string;
	description: string;
	headerClass?: string;
	products: MachineProduct[];
};

export type MachineCollection = {
	id: string;
	title: string;
	groups: MachineGroup[];
};

import rawMachinesJson from "./machines.generated.json" assert { type: "json" };

type RawMachineProduct = {
	id: string;
	name: string;
	description: string;
	notes?: string[];
	image: string;
	boxClass?: string;
	wrapperClass?: string;
	priceRon: number | null;
	unitLabel: string;
	priceClass?: string;
	extraClass?: string[];
};

type RawMachineGroup = {
	title: string;
	description: string;
	headerClass?: string;
	products: RawMachineProduct[];
};

type RawMachineCollection = {
	id: string;
	title: string;
	groups: RawMachineGroup[];
};

const rawCollections = rawMachinesJson as RawMachineCollection[];

export const machineCollections: MachineCollection[] = rawCollections.map((collection) => ({
	id: collection.id,
	title: collection.title,
	groups: collection.groups.map((group) => ({
		title: group.title,
		description: group.description,
		headerClass: group.headerClass,
		products: group.products.map((product) => ({
			id: product.id,
			name: product.name,
			description: product.description,
			notes: product.notes?.length ? product.notes : undefined,
			image: `/${product.image.replace(/^\/+/, "")}`,
			boxClass: product.boxClass,
			wrapperClass: product.wrapperClass,
			priceRon: product.priceRon ?? 0,
			unitLabel: product.unitLabel,
			priceClass: product.priceClass,
			extraClass: product.extraClass?.length ? product.extraClass : undefined,
		})),
	})),
}));
