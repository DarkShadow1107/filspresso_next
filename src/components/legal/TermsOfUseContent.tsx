import React from "react";
import Link from "next/link";
import "../../styles/legal-pages.css";

const sections = [
	{
		id: "acceptance",
		title: "Acceptance of Terms",
		content: (
			<>
				<p>
					By accessing or using the Filspresso website, web application, or any associated services (collectively the "
					<strong>Service</strong>"), you confirm that you have read, understood, and agree to be bound by these Terms
					of Use ("<strong>Terms</strong>"). If you do not agree, you must not use the Service.
				</p>
				<p>
					<em>Last updated: March 11, 2026</em>
				</p>
			</>
		),
	},
	{
		id: "eligibility",
		title: "Eligibility",
		content: (
			<>
				<p>
					You must be at least <strong>16 years old</strong> to create an account. By registering, you represent that
					you meet this requirement and that all information you provide is accurate and current.
				</p>
			</>
		),
	},
	{
		id: "accounts",
		title: "User Accounts",
		content: (
			<>
				<p>
					When you create an account you are responsible for maintaining the confidentiality of your credentials and for
					all activity that occurs under your account.
				</p>
				<ul>
					<li>You must not share your account with anyone else.</li>
					<li>You must notify us immediately if you suspect unauthorised access.</li>
					<li>
						We reserve the right to suspend or terminate accounts that violate these Terms, exhibit abusive behaviour,
						or remain inactive for more than 24 months.
					</li>
				</ul>
			</>
		),
	},
	{
		id: "services",
		title: "Filspresso Services",
		content: (
			<>
				<p>Filspresso provides the following features subject to your subscription tier:</p>
				<ul>
					<li>
						<strong>Coffee catalogue</strong> — browse Nespresso-compatible capsules and machines with detailed
						tasting notes, intensity, and origin information.
					</li>
					<li>
						<strong>Store</strong> — purchase Nespresso capsules, machines, and accessories. All purchases are
						governed by our <Link href="/sales-refunds">Sales &amp; Refunds Policy</Link>.
					</li>
					<li>
						<strong>Subscriptions</strong> — recurring plans that unlock premium features, discounts, and increased
						Kafelot AI capabilities.
					</li>
					<li>
						<strong>IoT integration</strong> — pair a compatible ESP32-based coffee machine to brew remotely via the
						app.
					</li>
					<li>
						<strong>Kafelot AI</strong> — see <a href="#kafelot">Kafelot AI Terms</a> below.
					</li>
				</ul>
				<p>
					We reserve the right to modify, suspend, or discontinue any part of the Service at any time with reasonable
					notice.
				</p>
			</>
		),
	},
	{
		id: "kafelot",
		title: "Kafelot AI Terms",
		content: (
			<>
				<p>
					Kafelot is an AI-powered coffee assistant that uses the <strong>Tanka</strong> model to respond to your
					questions. By using Kafelot you agree to the following:
				</p>
				<ul>
					<li>
						<strong>No warranties on AI output</strong> — Kafelot's responses are informational and may contain
						inaccuracies. Do not rely on Kafelot for medical, legal, financial, or safety-critical decisions.
					</li>
					<li>
						<strong>Acceptable use</strong> — you must not attempt to manipulate, jailbreak, or extract training data
						from the model; generate harmful, abusive, or illegal content; or circumvent any usage controls.
					</li>
					<li>
						<strong>Data handling</strong> — your messages are processed by our AI backend. Logged-in users may save
						conversation history which can be deleted at any time. Full details in the{" "}
						<Link href="/kafelot-privacy">Kafelot Privacy page</Link>.
					</li>
					<li>
						<strong>Availability</strong> — Kafelot is provided on a best-effort basis. We do not guarantee uptime or
						response accuracy.
					</li>
				</ul>
			</>
		),
	},
	{
		id: "iot",
		title: "IoT Device Integration",
		content: (
			<>
				<p>
					The Filspresso IoT feature allows you to send brew commands to a paired ESP32 device connected to a compatible
					Nespresso machine. By using this feature:
				</p>
				<ul>
					<li>
						You accept sole responsibility for the safe installation and use of the IoT hardware near electrical
						appliances.
					</li>
					<li>
						Filspresso is not responsible for any hardware damage, injury, or property damage resulting from device
						use or modification.
					</li>
					<li>
						IoT command logs are stored temporarily (90 days) to ensure delivery reliability, then automatically
						purged.
					</li>
					<li>
						The IoT firmware is provided as-is under the MIT licence. You may inspect and modify the source code at
						your own risk.
					</li>
				</ul>
			</>
		),
	},
	{
		id: "prohibited",
		title: "Prohibited Conduct",
		content: (
			<>
				<p>You must not:</p>
				<ul>
					<li>Use the Service for any unlawful purpose or in violation of any regulations.</li>
					<li>Attempt to gain unauthorised access to any system, database, or user account.</li>
					<li>Introduce malware, viruses, or any code designed to disrupt or damage the Service.</li>
					<li>Scrape, crawl, or systematically extract data from the Service without written permission.</li>
					<li>Impersonate any person or entity or misrepresent your affiliation with any person or entity.</li>
					<li>
						Use automated tools to send more requests than reasonably required for normal human use (e.g. denial of
						service).
					</li>
				</ul>
			</>
		),
	},
	{
		id: "ip",
		title: "Intellectual Property",
		content: (
			<>
				<p>
					All content on the Service — including text, graphics, logos, product images, software, and the Kafelot AI
					model weights — is the property of Filspresso or its licensors and is protected by copyright and other
					intellectual property laws.
				</p>
				<p>
					You are granted a limited, non-exclusive, non-transferable licence to access and use the Service for personal,
					non-commercial purposes. You may not reproduce, distribute, or create derivative works without prior written
					consent.
				</p>
				<p>
					The source code of the Filspresso project is available under the{" "}
					<a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener noreferrer">
						MIT Licence
					</a>{" "}
					where indicated.
				</p>
			</>
		),
	},
	{
		id: "liability",
		title: "Limitation of Liability",
		content: (
			<>
				<p>
					To the fullest extent permitted by law, Filspresso and its contributors shall not be liable for any indirect,
					incidental, special, consequential, or punitive damages arising from your use of the Service, including but
					not limited to reliance on AI-generated content, IoT hardware incidents, or service interruptions.
				</p>
				<p>
					Our total liability to you for any claim arising out of or relating to these Terms or your use of the Service
					shall not exceed the amount you paid to us in the 12 months preceding the claim.
				</p>
			</>
		),
	},
	{
		id: "governing-law",
		title: "Governing Law",
		content: (
			<>
				<p>
					These Terms are governed by and construed in accordance with the laws of Romania and applicable European Union
					regulations, without regard to conflict-of-law principles. Any disputes shall be subject to the exclusive
					jurisdiction of the competent courts of Romania.
				</p>
			</>
		),
	},
	{
		id: "changes",
		title: "Changes to These Terms",
		content: (
			<>
				<p>
					We may update these Terms at any time. We will notify you of material changes via in-app notification or email
					at least 14 days before the changes take effect. Continued use after the effective date constitutes acceptance
					of the updated Terms.
				</p>
				<p>
					If you have questions about these Terms, contact us at{" "}
					<a href="mailto:legal@filspresso.com">legal@filspresso.com</a>.
				</p>
			</>
		),
	},
];

export default function TermsOfUseContent() {
	return (
		<main className="legal-page">
			<div className="lp-hero">
				<div className="lp-hero-inner">
					<div className="lp-hero-badge">Legal</div>
					<h1 className="lp-hero-title">Terms of Use</h1>
					<p className="lp-hero-subtitle">
						The rules and conditions that govern your use of the Filspresso website, store, Kafelot AI, and IoT
						integration services.
					</p>
				</div>
			</div>

			<div className="lp-layout">
				<nav className="lp-toc" aria-label="Table of contents">
					<p className="lp-toc-label">On this page</p>
					<div className="lp-toc-list">
						{sections.map((s) => (
							<a key={s.id} className="lp-toc-link" href={`#${s.id}`}>
								{s.title}
							</a>
						))}
					</div>
				</nav>

				<article className="lp-content">
					{sections.map((s) => (
						<section key={s.id} id={s.id} className="lp-section">
							<h2 className="lp-section-title">{s.title}</h2>
							<div className="lp-section-body">{s.content}</div>
						</section>
					))}

					<div className="lp-back-link">
						<Link href="/">← Back to Filspresso</Link>
					</div>
				</article>
			</div>
		</main>
	);
}
