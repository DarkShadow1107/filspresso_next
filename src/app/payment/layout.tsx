import type { PropsWithChildren } from "react";

export default function PaymentLayout({ children }: PropsWithChildren) {
	return <section className="payment-layout">{children}</section>;
}
