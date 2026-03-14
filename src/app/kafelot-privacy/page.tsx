import KafelotPrivacyContent from "@/components/kafelot/KafelotPrivacyContent";

export const metadata = {
	title: "Your Privacy & Kafelot | Filspresso",
	description:
		"Learn how Kafelot AI handles your data, privacy practices, and what information is used to power your coffee recommendations.",
};

export const dynamic = "force-static";

export default function KafelotPrivacyPage() {
	return <KafelotPrivacyContent />;
}
