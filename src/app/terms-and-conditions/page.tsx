import TermsAndConditions from "@/components/legal/TermsAndConditionsContent";

export const metadata = {
	title: "Terms and Conditions | Filspresso",
	description:
		"Terms and conditions governing your use of the Filspresso website, store, Kafelot AI, and IoT integration services.",
};

export const dynamic = "force-static";

export default function TermsAndConditionsPage() {
	return <TermsAndConditions />;
}
