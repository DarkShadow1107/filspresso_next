import React from "react";
import Link from "next/link";
import "../../styles/legal-pages.css";

const sections = [
	{
		id: "introduction",
		title: "Introduction",
		content: (
			<>
				<p>
					Filspresso ("<strong>we</strong>", "<strong>our</strong>", or "<strong>us</strong>") operates the Filspresso
					website, mobile-optimised web application, and associated IoT services (collectively, the "
					<strong>Service</strong>"). This Privacy Policy explains how we collect, use, and protect your personal
					information when you use the Service.
				</p>
				<p>
					By using Filspresso, you agree to the practices described in this policy. If you disagree, please discontinue
					use and contact us to request deletion of any data we may hold.
				</p>
				<p>
					<em>Last updated: March 11, 2026</em>
				</p>
			</>
		),
	},
	{
		id: "information-we-collect",
		title: "Information We Collect",
		content: (
			<>
				<p>We may collect the following categories of data:</p>
				<ul>
					<li>
						<strong>Account data</strong> — username, email address, and hashed password when you register.
					</li>
					<li>
						<strong>Profile & preferences</strong> — name, saved payment methods (stored encrypted), and subscription
						tier.
					</li>
					<li>
						<strong>Order & transaction data</strong> — product orders, cart contents, and purchase history.
					</li>
					<li>
						<strong>IoT device data</strong> — if you pair an ESP32-based coffee machine, brew commands sent to the
						device and machine status messages are stored temporarily for reliability.
					</li>
					<li>
						<strong>Usage data</strong> — pages visited, features used, and approximate location derived from your IP
						address for analytics.
					</li>
					<li>
						<strong>Communications</strong> — messages sent through contact forms or support channels.
					</li>
				</ul>
				<p>
					For AI-specific data collected by Kafelot, see the <Link href="/kafelot-privacy">Kafelot Privacy page</Link>.
				</p>
			</>
		),
	},
	{
		id: "how-we-use",
		title: "How We Use Your Information",
		content: (
			<>
				<p>Your data is used to:</p>
				<ul>
					<li>Provide, personalise, and improve the Service.</li>
					<li>Process orders and subscriptions.</li>
					<li>Send transactional emails (order confirmations, subscription receipts).</li>
					<li>Communicate important updates or changes to the Service.</li>
					<li>Detect and prevent fraudulent or abusive activity.</li>
					<li>Comply with legal obligations.</li>
				</ul>
				<p>
					We do <strong>not</strong> sell your personal data to third parties. We do not use your data for targeted
					advertising through external ad networks.
				</p>
			</>
		),
	},
	{
		id: "cookies",
		title: "Cookies & Local Storage",
		content: (
			<>
				<p>
					The Filspresso website uses <strong>localStorage</strong> and session cookies to maintain your login state and
					preferences. No third-party tracking or advertising cookies are used.
				</p>
				<ul>
					<li>
						<code>auth_token</code> — your encrypted authentication token, required to stay logged in.
					</li>
					<li>
						<code>kafelot_fp</code> — an anonymous session identifier used by the Kafelot AI feature (see{" "}
						<Link href="/kafelot-privacy">Kafelot Privacy</Link>).
					</li>
				</ul>
				<p>
					You can clear all locally stored data through your browser settings at any time. Doing so will log you out of
					the Service.
				</p>
			</>
		),
	},
	{
		id: "data-sharing",
		title: "Data Sharing",
		content: (
			<>
				<p>We only share data with third parties in the following limited circumstances:</p>
				<ul>
					<li>
						<strong>Service infrastructure</strong> — cloud hosting and database providers who process data on our
						behalf under strict data-processing agreements.
					</li>
					<li>
						<strong>Payment processors</strong> — encrypted card details passed to our payment provider; we do not
						store raw card numbers.
					</li>
					<li>
						<strong>Legal requirements</strong> — if required by law, court order, or to protect the rights and safety
						of Filspresso or its users.
					</li>
				</ul>
				<p>We never share your data for marketing purposes with third parties.</p>
			</>
		),
	},
	{
		id: "data-security",
		title: "Data Security",
		content: (
			<>
				<p>
					We implement industry-standard security measures including encrypted connections (HTTPS), hashed passwords
					(bcrypt), encrypted storage of sensitive fields (AES-256), and regular security reviews.
				</p>
				<p>
					No system is perfectly secure. In the event of a data breach that affects your personal information, we will
					notify you as required by applicable law within 72 hours of becoming aware.
				</p>
			</>
		),
	},
	{
		id: "data-retention",
		title: "Data Retention",
		content: (
			<>
				<ul>
					<li>
						<strong>Account data</strong> — retained while your account is active. Deleted within 30 days of account
						closure on request.
					</li>
					<li>
						<strong>Order records</strong> — retained for 7 years to comply with financial and tax regulations.
					</li>
					<li>
						<strong>IoT command logs</strong> — automatically purged after 90 days.
					</li>
					<li>
						<strong>Analytics data</strong> — aggregated and anonymised after 12 months.
					</li>
				</ul>
			</>
		),
	},
	{
		id: "your-rights",
		title: "Your Rights",
		content: (
			<>
				<p>
					Depending on your location, you may have rights under applicable data-protection law (e.g. GDPR, CCPA),
					including:
				</p>
				<ul>
					<li>
						<strong>Access</strong> — request a copy of all data we hold about you.
					</li>
					<li>
						<strong>Correction</strong> — request correction of inaccurate personal data.
					</li>
					<li>
						<strong>Deletion</strong> — request erasure of your personal data ("right to be forgotten").
					</li>
					<li>
						<strong>Portability</strong> — receive your data in a structured, machine-readable format.
					</li>
					<li>
						<strong>Objection / restriction</strong> — object to or restrict certain processing activities.
					</li>
				</ul>
				<p>
					To exercise any right, contact us at <a href="mailto:privacy@filspresso.com">privacy@filspresso.com</a>. We
					aim to respond within 30 days.
				</p>
			</>
		),
	},
	{
		id: "contact",
		title: "Contact Us",
		content: (
			<>
				<p>If you have questions about this Privacy Policy or about your data, please contact:</p>
				<ul>
					<li>
						<strong>Email:</strong> <a href="mailto:privacy@filspresso.com">privacy@filspresso.com</a>
					</li>
				</ul>
			</>
		),
	},
	{
		id: "changes",
		title: "Changes to This Policy",
		content: (
			<>
				<p>
					We may update this policy from time to time. Significant changes will be communicated via in-app notification
					or email. Continued use of the Service after the effective date of any update constitutes acceptance.
				</p>
			</>
		),
	},
];

export default function PrivacyPolicyContent() {
	return (
		<main className="legal-page">
			<div className="lp-hero">
				<div className="lp-hero-inner">
					<div className="lp-hero-badge">Legal</div>
					<h1 className="lp-hero-title">Privacy Policy</h1>
					<p className="lp-hero-subtitle">
						How Filspresso collects, uses, and protects your personal information across our website and services.
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
