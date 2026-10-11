"use client";

import { useEffect, useState } from "react";
import RefreshIcon from "@/icons/refresh-icon";

/**
 * Read-only model pricing, for the admin panel.
 *
 * Shows both columns that exist for a model: the API list price, and what a paying plan is
 * actually charged after its discount. No other surface needs the pair, which is why this
 * asks for `audience=all` -- the discount percentage is the one field that would let a
 * visitor reconstruct the tier table from outside, so it is absent from every customer
 * response.
 *
 * Read-only on purpose. Prices live in code, not in a table, so anything that looked
 * editable here would be a lie about where the number comes from. Changing a price is a
 * code change and a deploy.
 */

type Row = {
	modelKey: string;
	label: string;
	apiInputPer1M: number;
	apiOutputPer1M: number;
	subscriberInputPer1M: number;
	subscriberOutputPer1M: number;
	subscriberDiscountPercent: number;
};

const ron = (v: number) => `${Number(v || 0).toFixed(2)}`;

export default function AdminPricingPanel() {
	const [rows, setRows] = useState<Row[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/billing/pricing?audience=all", { credentials: "include", cache: "no-store" })
			.then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
			.then((body: { models?: Row[] }) => {
				if (cancelled) return;
				setRows(body.models ?? []);
				setError(null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Could not load pricing.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [nonce]);

	return (
		<section className="admin-panel">
			<div className="table-header">
				<div className="table-title">
					<h2>Model pricing</h2>
					<span className="row-count">{rows.length} models</span>
				</div>
				<div className="table-actions">
					<button
						className="refresh-button"
						onClick={() => {
							// Set from the click, not from the effect: an effect that sets state
							// synchronously renders before the browser paints, which here is a
							// flicker on a table that is already on screen.
							setLoading(true);
							setNonce((n) => n + 1);
						}}
						disabled={loading}
					>
						<RefreshIcon size={16} /> Refresh
					</button>
				</div>
			</div>

			{error && <div className="action-error">Could not load pricing: {error}</div>}

			<div className="data-table-container">
				{loading && <div className="loading-overlay">Loading...</div>}
				<table className="data-table">
					<thead>
						<tr>
							<th>model_key</th>
							<th>Label</th>
							<th>API in / 1M</th>
							<th>API out / 1M</th>
							<th>Plan in / 1M</th>
							<th>Plan out / 1M</th>
							<th>Discount</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.modelKey}>
								<td>
									<span className="cell-value">{r.modelKey}</span>
								</td>
								<td>
									<span className="cell-value">{r.label}</span>
								</td>
								<td>{ron(r.apiInputPer1M)}</td>
								<td>{ron(r.apiOutputPer1M)}</td>
								<td>{ron(r.subscriberInputPer1M)}</td>
								<td>{ron(r.subscriberOutputPer1M)}</td>
								<td>
									<span className="cell-value">{r.subscriberDiscountPercent}%</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<p className="upload-hint" style={{ marginTop: "1rem" }}>
				RON per million tokens. Read-only: prices are defined in code, so changing one is a code
				change and a deploy, not an edit here.
			</p>
		</section>
	);
}