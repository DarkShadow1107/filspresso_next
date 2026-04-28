import React from "react";
import Link from "next/link";
import "../../styles/kafelot-privacy.css";

const sections = [
	{
		id: "what-is-kafelot",
		title: "What is Kafelot?",
		content: (
			<>
				<p>
					Kafelot is an AI-powered coffee assistant built into the Filspresso platform. It uses a lightweight language
					model stack (MiniLM, Qwen, Gemma, and eligible vision GGUF models) to answer questions about coffee, suggest
					Nespresso capsules based on your taste preferences, and, for Ultimate subscribers, explore molecular
					structures of coffee-related compounds.
				</p>
				<p>
					Kafelot is designed to be helpful, fast, and focused. Like all AI systems, it can sometimes produce inaccurate
					or outdated information. Always verify critical details through official sources.
				</p>
			</>
		),
	},
	{
		id: "data-we-collect",
		title: "Data Kafelot Collects",
		content: (
			<>
				<p>When you interact with Kafelot, the following data may be processed to deliver the service:</p>
				<ul>
					<li>
						<strong>Your messages</strong> — the text (and images, for eligible subscribers) you send in the chat
						window. Messages are sent to our AI backend for processing and are not permanently stored by the AI model
						itself.
					</li>
					<li>
						<strong>Session data</strong> — if you are logged in, your conversation history is saved to our database
						so you can access it later. You can delete individual chats or your entire history at any time from the
						chat interface.
					</li>
					<li>
						<strong>Anonymous session records</strong> — visitors who are not logged in are assigned a sequential
						anonymous identifier (e.g. <strong>A1</strong>, <strong>A2</strong>, …) alongside the full client IP
						address and User-Agent string for abuse-prevention purposes only.
					</li>
				</ul>
			</>
		),
	},
	{
		id: "anonymous-users",
		title: "Anonymous Visitors",
		content: (
			<>
				<p>
					You do not need an account to use Kafelot. Anonymous visitors receive a monthly prompt allowance (see the
					table below). Usage is tracked using a sequential anonymous identifier — no personal account is required.
				</p>
				<p>
					Each anonymous session is assigned a short sequential identifier (<strong>A1</strong>, <strong>A2</strong>,
					etc.) stored in our system alongside your full IP address and browser User-Agent string for abuse-prevention
					purposes only. This record is never linked to your identity unless you create an account.
				</p>
				<p>
					Prompt counters reset on the first day of each calendar month. Anonymous session records are automatically
					purged after 12 months of inactivity and are never sold or shared with third parties.
				</p>
			</>
		),
	},
	{
		id: "subscription-limits",
		title: "Subscription & Prompt Limits",
		content: (
			<>
				<p>
					Prompt limits apply on a monthly basis and reset on the first day of each calendar month. Subscription tiers
					also unlock additional features such as extended context, image input (Ultimate), and priority response times.
				</p>
				<table className="privacy-table">
					<thead>
						<tr>
							<th>Tier</th>
							<th>Prompts / month</th>
							<th>Notable features</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Anonymous (no account)</td>
							<td>5</td>
							<td>Basic coffee recommendations</td>
						</tr>
						<tr>
							<td>Free (account, no subscription)</td>
							<td>15</td>
							<td>Extended access</td>
						</tr>
						<tr>
							<td>Basic</td>
							<td>50</td>
							<td>Extended recommendations</td>
						</tr>
						<tr>
							<td>Plus</td>
							<td>100</td>
							<td>Priority responses</td>
						</tr>
						<tr>
							<td>Pro</td>
							<td>150</td>
							<td>Longer context window</td>
						</tr>
						<tr>
							<td>Max</td>
							<td>300</td>
							<td>Advanced analysis</td>
						</tr>
						<tr>
							<td>Ultimate</td>
							<td>1 000</td>
							<td>Image input, molecular explorer</td>
						</tr>
					</tbody>
				</table>
				<p>
					Administrators can manually adjust individual limits through the Filspresso admin panel if needed (e.g. to
					grant a courtesy credit). Detailed tier pricing and benefits are on the{" "}
					<Link href="/?page=subscription">Subscription page</Link>.
				</p>
			</>
		),
	},
	{
		id: "how-we-use-data",
		title: "How We Use Your Data",
		content: (
			<>
				<p>Data processed through Kafelot is used exclusively to:</p>
				<ul>
					<li>Generate responses to your questions and recommendations.</li>
					<li>Enforce monthly usage limits and prevent abuse.</li>
					<li>Save your conversation history (logged-in users only, if you choose to use that feature).</li>
					<li>Improve the quality and safety of the Kafelot service over time.</li>
				</ul>
				<p>
					We do <strong>not</strong> sell, rent, or share your conversation content with third parties for advertising
					purposes. We do not use your messages to train external AI models.
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
						<strong>Chat sessions</strong> — retained until you delete them or your account is closed.
					</li>
					<li>
						<strong>Anonymous fingerprint records</strong> — retained for 12 months of inactivity, after which they
						are automatically purged.
					</li>
					<li>
						<strong>Usage counters</strong> — retained for 12 months to allow trend analysis, then purged.
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
				<p>Depending on your location, you may have rights under applicable data-protection law, including:</p>
				<ul>
					<li>
						<strong>Access</strong> — request a copy of the data we hold about you.
					</li>
					<li>
						<strong>Correction</strong> — ask us to correct inaccurate data.
					</li>
					<li>
						<strong>Deletion</strong> — ask us to erase your data (&quot;right to be forgotten&quot;).
					</li>
					<li>
						<strong>Objection / restriction</strong> — object to or restrict certain processing.
					</li>
				</ul>
				<p>
					To exercise any of these rights, contact us at{" "}
					<a href="mailto:privacy@filspresso.com">privacy@filspresso.com</a>. We will respond within 30 days.
				</p>
			</>
		),
	},
	{
		id: "ai-accuracy",
		title: "AI Accuracy & Limitations",
		content: (
			<>
				<p>
					Kafelot uses rule-based logic combined with retrieval and subscription-selected GGUF models to respond to your
					questions. While we strive for accuracy, AI systems can and do make mistakes — including errors about people,
					places, products, and scientific facts.
				</p>
				<p>
					<strong>Do not rely on Kafelot for medical, legal, financial, or safety-critical decisions.</strong>{" "}
					Information about coffee health effects, chemical compounds, and nutrition is provided for general interest
					only.
				</p>
				<p>
					If you notice an incorrect or harmful response, please report it using the feedback option in your account
					settings.
				</p>
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
					or email. Continued use of Kafelot after the effective date of any changes constitutes acceptance of the
					updated policy.
				</p>
				<p>
					<em>Last updated: March 11, 2026</em>
				</p>
			</>
		),
	},
];

export default function KafelotPrivacyContent() {
	return (
		<main className="kafelot-privacy-page">
			{/* Hero */}
			<div className="kp-hero">
				<div className="kp-hero-inner">
					<div className="kp-hero-badge">Privacy &amp; Kafelot</div>
					<h1 className="kp-hero-title">Your Privacy &amp; Kafelot</h1>
					<p className="kp-hero-subtitle">
						How Kafelot AI handles your data, respects your privacy, and what you can expect when you chat with your
						coffee assistant.
					</p>
				</div>
			</div>

			<div className="kp-layout">
				{/* Centered inline TOC */}
				<nav className="kp-toc" aria-label="Table of contents">
					<p className="kp-toc-label">On this page</p>
					<div className="kp-toc-list">
						{sections.map((s) => (
							<a key={s.id} className="kp-toc-link" href={`#${s.id}`}>
								{s.title}
							</a>
						))}
					</div>
				</nav>

				{/* Content */}
				<article className="kp-content">
					{sections.map((s) => (
						<section key={s.id} id={s.id} className="kp-section">
							<h2 className="kp-section-title">{s.title}</h2>
							<div className="kp-section-body">{s.content}</div>
						</section>
					))}

					<div className="kp-back-link">
						<Link href="/">← Back to Filspresso</Link>
					</div>
				</article>
			</div>
		</main>
	);
}
