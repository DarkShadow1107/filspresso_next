import SalesRefundsContent from "@/components/legal/SalesRefundsContent";

export const metadata = {
	title: "Sales & Refunds | Filspresso",
	description: "Filspresso store purchase policies — ordering, pricing, payment, shipping, returns, and refunds.",
};

export const dynamic = "force-static";

export default function SalesRefundsPage() {
	return <SalesRefundsContent />;
}
