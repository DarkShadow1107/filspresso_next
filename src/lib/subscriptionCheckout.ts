/**
 * The intent behind a subscription checkout.
 *
 * ## Why a subscription does not go in the shopping cart
 *
 * It used to. The plans page added a fake line item -- `sub-ultimate`, priced at 599.99 --
 * to the coffee cart and sent the customer to the payment page, which is a page built
 * entirely around buying coffee.
 *
 * That could not work, and it failed in the most expensive way it could:
 *
 *   - The cart rejected the line item, because it was a coffee capsule named "sub-ultimate"
 *     and no such capsule exists. The customer saw "Product not found in stock inventory".
 *   - The plans page navigated to payment regardless, so the customer arrived at a checkout
 *     with an empty cart: subtotal 0.
 *   - The payment page then charged the **coffee delivery fee** -- 24.99 RON -- because that
 *     is what an empty cart with no free-shipping tier costs.
 *
 * So the customer was asked to pay 24.99 RON for a 599.99 RON plan, with a stock error in
 * front of it.
 *
 * A subscription is not merchandise. It has no stock, no delivery, and no destination, and
 * the thing that records it is the subscription ledger rather than the orders table. This
 * module carries the intent from the plans page to the checkout, and the checkout does the
 * coffee flow only when there is coffee.
 */
export type SubscriptionCheckoutIntent = {
	/** The tier being bought: "basic", "plus", "pro", "max" or "ultimate". */
	tier: string;
	/** "monthly" or "annual". */
	cycle: "monthly" | "annual";
	/** For display only. The charged price comes from the server. */
	title: string;
	/** For display only. The charged price comes from the server. */
	priceRon: number;
};

const INTENT_KEY = "subscription_checkout_intent";

export function writeSubscriptionIntent(intent: SubscriptionCheckoutIntent): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
	} catch {
		// A browser with storage disabled cannot carry the intent. The checkout will then
		// fall back to the coffee flow, which is the old behaviour and no worse.
	}
}

export function readSubscriptionIntent(): SubscriptionCheckoutIntent | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.sessionStorage.getItem(INTENT_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as SubscriptionCheckoutIntent;
		if (!parsed || typeof parsed.tier !== "string" || !parsed.tier) return null;
		if (parsed.cycle !== "monthly" && parsed.cycle !== "annual") return null;
		return parsed;
	} catch {
		return null;
	}
}

export function clearSubscriptionIntent(): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.removeItem(INTENT_KEY);
	} catch {
		// Nothing to do: the intent simply expires with the tab.
	}
}
