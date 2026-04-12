import PrivacyPolicyContent from "@/components/legal/PrivacyPolicyContent";

export const metadata = {
	title: "Privacy Policy | Filspresso",
	description:
		"Filspresso's Privacy Policy — how we collect, use, and protect your personal information across our website and services.",
};

export const dynamic = "force-static";

export default function PrivacyPolicyPage() {
	return <PrivacyPolicyContent />;
}
