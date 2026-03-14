import TermsOfUseContent from "@/components/legal/TermsOfUseContent";

export const metadata = {
	title: "Terms of Use | Filspresso",
	description:
		"Terms and conditions governing your use of the Filspresso website, store, Kafelot AI, and IoT integration services.",
};

export const dynamic = "force-static";

export default function TermsOfUsePage() {
	return <TermsOfUseContent />;
}
