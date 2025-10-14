"use client";

import useCart from "@/hooks/useCart";

function formatRon(value: number) {
	return `${value.toFixed(2).replace(".", ",")} RON`;
}

export default function Cart() {
	const { items, currentSum, reset, placeOrder } = useCart();
	const hasItems = items.length > 0;
	const displayedTotal = formatRon(currentSum);

	return (
		<>
			<div id="total">
				<div id="resultDiv">Total price of the bag: {displayedTotal}</div>
				<button id="resetButton" type="button" onClick={() => reset()}>
					Empty the bag
				</button>
				{hasItems ? (
					<div className="itemListBag">
						<ul>
							{items.map((item) => {
								const quantitySuffix = item.qty > 1 ? ` x ${item.qty}` : "";
								return <li key={item.id}>{`${item.name}${quantitySuffix}`}</li>;
							})}
						</ul>
					</div>
				) : null}
			</div>
			<button id="placeOrderButton" type="button" className="bag-place-order" onClick={placeOrder}>
				Place order
			</button>
		</>
	);
}
