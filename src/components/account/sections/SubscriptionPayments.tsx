"use client";

import { useEffect, useState } from "react";
import RefreshIcon from "@/icons/refresh-icon";
import { CreditCard } from "@/icons";

/**
 * What this account has paid for its subscription.
 *
 * Two statuses per purchase, and the reason they are not one: whether the charge completed
 * and whether access was granted are different facts. A row reading "paid, not delivered"
 * is the state a customer would ring us about, and it cannot exist if the two are collapsed
 * into a single word.
 *
 * Note that nothing here is a parcel. "Delivered" means the plan was provisioned.
 */

type Payment = {
	id: number;
	tier: string;
	billingCycle: string;
	amountRon: number;
	currency: string;
	cardLastFour: string | null;
	paymentStatus: string;
	fulfilmentStatus: string;
	reference: string | null;
	createdAt: string;
};

const PAYMENT_TONE: Record<string, string> = {
	paid: "pay-ok",
	pending: "pay-warn",
	failed: "pay-bad",
	refunded: "pay-muted",
};

const FULFILMENT_LABEL: Record<string, string> = {
	delivered: "Access active",
	pending: "Not yet granted",
	revoked: "Access revoked",
};

const ron = (v: number) =>
	`${Number(v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SubscriptionPayments({ className }: { className?: string }) {
	const [payments, setPayments] = useState<Payment[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/subscriptions/payments", { credentials: "include", cache: "no-store" })
			.then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
			.then((body: Payment[] | { payments?: Payment[] }) => {
				if (cancelled) return;
				// The endpoint returns an array; tolerate a wrapped shape rather than rendering
				// nothing if it ever changes.
				const rows = Array.isArray(body) ? body : body.payments ?? [];
				setPayments(rows);
				setError(null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Could not load payment history.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [nonce]);

	return (
		<div className={className}>
			<div className="card billing-card">
				<div className="billing-card__title-row">
					<h3 className="billing-card__title">Subscription payments</h3>
					<button
						type="button"
						className="billing-refresh"
						onClick={() => {
							setLoading(true);
							setNonce((n) => n + 1);
						}}
						disabled={loading}
						aria-label="Refresh payment history"
					>
						<RefreshIcon size={15} />
					</button>
				</div>

				{error && <p className="billing-error">{error}</p>}
				{!error && payments.length === 0 && !loading && (
					<p className="billing-muted">
						No subscription payments yet. Your first paid plan will appear here.
					</p>
				)}

				{payments.length > 0 && (
					<table className="billing-table">
						<thead>
							<tr>
								<th scope="col">Date</th>
								<th scope="col">Plan</th>
								<th scope="col">Paid</th>
								<th scope="col">Payment</th>
								<th scope="col">Access</th>
							</tr>
						</thead>
						<tbody>
							{payments.map((p) => (
								<tr key={p.id}>
									<td>{new Date(p.createdAt).toLocaleDateString()}</td>
									<td>
										{p.tier.charAt(0).toUpperCase() + p.tier.slice(1)}
										<em className="billing-cell-sub">
											{p.billingCycle === "annual" ? "annual" : "monthly"}
											{p.cardLastFour ? ` · •••• ${p.cardLastFour}` : ""}
										</em>
									</td>
									<td>
										{ron(p.amountRon)} {p.currency}
									</td>
									<td>
										<span className={`billing-status ${PAYMENT_TONE[p.paymentStatus] ?? "pay-muted"}`}>
											{p.paymentStatus}
										</span>
									</td>
									<td>
										<span className="billing-status pay-ok">
											<CreditCard size={12} />
											{FULFILMENT_LABEL[p.fulfilmentStatus] ?? p.fulfilmentStatus}
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}