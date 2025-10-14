"use client";

import Image from "next/image";
import Cart from "@/components/Cart";

export default function ShoppingBagPageContent() {
	return (
		<main className="shopping-bag-page" id="order">
			<div className="bag_pres">
				<Image src="/images/Nespresso_bag_header.jpg" alt="Shopping bag" width={1920} height={1080} priority />
			</div>
			<Cart />
		</main>
	);
}
