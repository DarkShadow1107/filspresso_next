import ServicesStatusContent from "@/components/services/ServicesStatusContent";

export const metadata = {
	title: "Services Status | Filspresso",
	description:
		"Live Filspresso infrastructure status for Server-side API, PostgreSQL Database, AI Model Services, and Administration Console.",
};

export const dynamic = "force-static";

export default function ServicesPage() {
	return <ServicesStatusContent />;
}
