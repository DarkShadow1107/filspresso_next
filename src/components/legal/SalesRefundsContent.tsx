import React from "react";
import Link from "next/link";
import "../../styles/legal-pages.css";
import { CURRENCY_CONFIG } from "@/lib/paymentCurrency";

const currencyRows = ["RON", "EUR", "CZK", "DKK", "PLN", "CHF", "TRY"].map((currencyCode) => ({
	currencyCode,
	label: CURRENCY_CONFIG[currencyCode as keyof typeof CURRENCY_CONFIG].label,
	feePercent: CURRENCY_CONFIG[currencyCode as keyof typeof CURRENCY_CONFIG].feePercent,
}));

const sections = [
	{
		id: "overview",
		title: "Overview",
		content: (
			<>
				<p>
					This Sales & Refunds Policy applies to all purchases made through the Filspresso online store, including
					Nespresso-compatible capsules, coffee machines, accessories, and subscription plans.
				</p>
				<p>
					By placing an order you agree to this policy. If you have questions before purchasing, contact us at{" "}
					<a href="mailto:support@filspresso.com">support@filspresso.com</a>.
				</p>
				<p>
					<em>Last updated: March 11, 2026</em>
				</p>
			</>
		),
	},
	{
		id: "ordering",
		title: "Placing an Order",
		content: (
			<>
				<p>
					All orders are subject to availability. After placing an order you will receive an email confirmation. This
					confirmation is acknowledgement of receipt — it does not constitute acceptance of the order. We reserve the
					right to refuse or cancel any order if a product is out of stock, priced incorrectly, or if we suspect
					fraudulent activity.
				</p>
				<p>
					Orders can be placed only through the Filspresso website. Telephone or social-media orders are not accepted.
				</p>
			</>
		),
	},
	{
		id: "pricing",
		title: "Pricing & Availability",
		content: (
			<>
				<p>
					All catalogue prices are listed in <strong>RON</strong> as the base store currency. During checkout you may
					switch the payment currency to <strong>EUR</strong>, <strong>CZK</strong>, <strong>DKK</strong>,{" "}
					<strong>PLN</strong>, <strong>CHF</strong>, or <strong>TRY</strong>. Daily exchange rates are applied at
					checkout, and currencies other than RON include an additional conversion tax.
				</p>
				<p>
					Prices are subject to change without notice. The price shown at the time you complete checkout is the price
					you pay — subsequent price changes do not apply retroactively to confirmed orders.
				</p>
				<p>
					In the event of a pricing error, we will contact you before processing your order to offer the corrected price
					or a full cancellation and refund.
				</p>
				<table className="lp-table">
					<thead>
						<tr>
							<th>Currency</th>
							<th>Description</th>
							<th>Conversion tax</th>
						</tr>
					</thead>
					<tbody>
						{currencyRows.map((row) => (
							<tr key={row.currencyCode}>
								<td>{row.currencyCode}</td>
								<td>{row.label}</td>
								<td>{row.feePercent === 0 ? "No conversion tax" : `${row.feePercent}%`}</td>
							</tr>
						))}
					</tbody>
				</table>
				<p>
					The conversion tax is calculated from the daily exchange transaction rate used at checkout. RON payments are
					not subject to this additional conversion tax.
				</p>
			</>
		),
	},
	{
		id: "payment",
		title: "Payment Methods",
		content: (
			<>
				<p>We accept the following cards:</p>
				<ul>
					<li>Visa</li>
					<li>Mastercard</li>
					<li>Maestro</li>
					<li>American Express</li>
					<li>Discover</li>
				</ul>
				<p>
					You can also pay using a card saved in the Filspresso payment vault (encrypted with AES-256). Payment is
					processed at the time of order placement. Card details are never stored in plaintext — only an encrypted vault
					entry linked to your account is retained.
				</p>
				<p>
					At the payment step you may choose to settle the order in RON, EUR, Czech koruna, Danish krone, Polish złoty,
					Swiss franc, or Turkish lira. The checkout summary will always show the exchange rate used that day together
					with any applicable conversion tax before you confirm the payment.
				</p>
			</>
		),
	},
	{
		id: "subscriptions",
		title: "Subscription Plans",
		content: (
			<>
				<p>
					Filspresso offers recurring subscription plans (Basic, Plus, Pro, Max, Ultimate). By subscribing you authorise
					us to charge your saved payment method on a monthly basis on the renewal date shown in your account settings.
				</p>
				<ul>
					<li>
						<strong>Cancellation</strong> — you may cancel at any time from your account dashboard. Your subscription
						remains active until the end of the current billing period; no partial-month refunds are issued.
					</li>
					<li>
						<strong>Upgrades / downgrades</strong> — changes take effect at the start of the next billing cycle.
					</li>
					<li>
						<strong>Trial periods</strong> — if a trial is offered, no charge is made until the trial ends. You may
						cancel during the trial at no cost.
					</li>
				</ul>
			</>
		),
	},
	{
		id: "shipping",
		title: "Shipping",
		content: (
			<>
				<p>
					Physical products (capsules, machines, accessories) are shipped within the <strong>European Union</strong>.
					<strong> Switzerland</strong> and <strong>Turkey</strong> are accepted as explicit exceptions to that EU-only
					shipment rule, and customers in those destinations may pay in <strong>CHF</strong> and <strong>TRY </strong>
					respectively. Estimated delivery times are shown at checkout and are indicative only.
				</p>
				<table className="lp-table">
					<thead>
						<tr>
							<th>Destination</th>
							<th>Estimated delivery</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Romania</td>
							<td>1–3 business days</td>
						</tr>
						<tr>
							<td>EU (Western)</td>
							<td>3–7 business days</td>
						</tr>
						<tr>
							<td>EU (Eastern)</td>
							<td>2–5 business days</td>
						</tr>
						<tr>
							<td>Switzerland</td>
							<td>3–7 business days</td>
						</tr>
						<tr>
							<td>Turkey</td>
							<td>4–8 business days</td>
						</tr>
					</tbody>
				</table>
				<p>
					Free shipping is available on orders over <strong>200 RON</strong>. Once your order is dispatched you will
					receive a tracking number by email.
				</p>
				<p>Filspresso is not responsible for delays caused by customs, carrier disruptions, or force-majeure events.</p>
			</>
		),
	},
	{
		id: "returns",
		title: "Returns & Refunds",
		content: (
			<>
				<p>
					Under EU consumer-protection law, you have the right to withdraw from a purchase of physical goods within{" "}
					<strong>14 days</strong> of receiving the item, without providing a reason, provided the goods are unused, in
					original packaging, and in a resalable condition.
				</p>
				<p>
					<strong>How to initiate a return:</strong> Email{" "}
					<a href="mailto:support@filspresso.com">support@filspresso.com</a> with your order number and reason for
					return. We will send you a return authorisation and shipping instructions within 2 business days.
				</p>
				<ul>
					<li>Return shipping costs are the buyer's responsibility unless the item was damaged or sent in error.</li>
					<li>
						Refunds are issued to the original payment method within <strong>14 days</strong> of receiving the
						returned item in good condition.
					</li>
				</ul>
				<div className="lp-note">
					<p>
						<strong>Non-returnable items:</strong> opened capsule sleeves, downloadable software, and digital
						subscription fees already consumed are not eligible for a refund.
					</p>
				</div>
			</>
		),
	},
	{
		id: "damaged",
		title: "Damaged or Incorrect Items",
		content: (
			<>
				<p>
					If you receive a damaged, defective, or incorrect item, please contact us within <strong>48 hours</strong> of
					delivery at <a href="mailto:support@filspresso.com">support@filspresso.com</a> — include your order number and
					photos of the damage or discrepancy.
				</p>
				<p>We will arrange a replacement dispatch or issue a full refund including return shipping at no cost to you.</p>
			</>
		),
	},
	{
		id: "contact",
		title: "Contact & Disputes",
		content: (
			<>
				<p>For all sales-related enquiries, order issues, or dispute resolution:</p>
				<ul>
					<li>
						<strong>Email:</strong> <a href="mailto:support@filspresso.com">support@filspresso.com</a>
					</li>
					<li>
						<strong>Response time:</strong> within 2 business days.
					</li>
				</ul>
				<p>
					If you are not satisfied with our resolution, you have the right to escalate to your national consumer
					protection authority or use the EU Online Dispute Resolution platform at{" "}
					<a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">
						ec.europa.eu/consumers/odr
					</a>
					.
				</p>
				<p>This policy is governed by Romanian law and applicable EU consumer protection directives.</p>
			</>
		),
	},
];

export default function SalesRefundsContent() {
	return (
		<main className="legal-page">
			<div className="lp-hero">
				<div className="lp-hero-inner">
					<div className="lp-hero-badge">Store Policies</div>
					<h1 className="lp-hero-title">Sales &amp; Refunds</h1>
					<p className="lp-hero-subtitle">
						Everything you need to know about placing orders, payment, shipping, returns, and refunds at the
						Filspresso store.
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
