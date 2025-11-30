"use client";

import Image from "next/image";
import useCart from "@/hooks/useCart";
import MachineNotificationsProvider, { useMachineNotifications } from "@/components/machines/MachineNotifications";
import { machineCollections, type MachineCollection, type MachineGroup, type MachineProduct } from "@/data/machines";

function formatRon(value: number) {
	return `${value.toFixed(2).replace(".", ",")} RON`;
}

function MachineProductCard({ product }: { product: MachineProduct }) {
	const { addItem } = useCart();
	const { notify } = useMachineNotifications();

	const handleAddToBag = () => {
		const itemName = `${product.name} - ${formatRon(product.priceRon)}`;
		addItem({ id: product.id, name: itemName, price: product.priceRon, image: product.image, productType: "machine" });
		// machine-scoped notify
		notify(`Added ${product.name} to bag!`, 6000);
	};

	const baseWrapperClass = product.wrapperClass ?? "machine_groups_models";
	const wrapperClasses = [baseWrapperClass, ...(product.extraClass ?? [])].join(" ");
	const priceWrapperClass = product.priceClass ? `bag_group ${product.priceClass}` : "bag_group";

	return (
		<div className={wrapperClasses}>
			<div className={product.boxClass ?? "machine_box"}>
				<Image
					src={product.image}
					alt={product.name}
					width={293}
					height={200}
					sizes="(max-width: 768px) 80vw, 293px"
					className="machine_image"
				/>
			</div>
			<h3 className="h3_capsule">{product.name}</h3>
			<div className="text_capsule">{product.description}</div>
			{product.notes?.map((note, idx) => (
				<p key={idx} className="text_capsule_2">
					{note}
				</p>
			))}
			<div className="machine_footer">
				<div className={priceWrapperClass} id="parentDiv2">
					<div className="price" id="sourceDiv2">
						{formatRon(product.priceRon)}
					</div>
					<div className="price_per_capsule">{product.unitLabel}</div>
					<button type="button" className="button_add_bag_2" onClick={handleAddToBag}>
						Add to Bag
					</button>
				</div>
			</div>
		</div>
	);
}

function MachineGroupSection({ group }: { group: MachineGroup }) {
	return (
		<div className="machine_groups">
			<div className={group.headerClass ?? "machine_groups_head"}>
				<div className="content_coffee_head">
					<h3>
						<strong>{group.title}</strong>
					</h3>
					<br />
					<div className="text_head">{group.description}</div>
				</div>
			</div>
			{group.products.map((product) => (
				<MachineProductCard key={product.id} product={product} />
			))}
		</div>
	);
}

function MachineCollectionSection({ collection }: { collection: MachineCollection }) {
	return (
		<section className={collection.id}>
			<h2 id={collection.id}>{collection.title}</h2>
			{collection.groups.map((group) => (
				<MachineGroupSection key={group.title} group={group} />
			))}
		</section>
	);
}

export default function MachinesPageContent() {
	return (
		<MachineNotificationsProvider>
			<main>
				<div className="coffee_pres">
					<Image src="/images/machines_background_subheader.png" alt="Machines background" width={1920} height={1080} />
				</div>
				<div className="nav_machine_type">
					<div className="glass_morph machine_type">
						<nav>
							<ul>
								{machineCollections.map((collection) => (
									<li key={collection.id}>
										<a href={`#${collection.id}`}>{collection.title}</a>
									</li>
								))}
							</ul>
						</nav>
					</div>
				</div>
				{machineCollections.map((collection) => (
					<MachineCollectionSection key={collection.id} collection={collection} />
				))}
			</main>
		</MachineNotificationsProvider>
	);
}
