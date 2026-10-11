"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, RefreshIcon, TriangleAlertIcon } from "@/icons";
import { tierCanUsePlayground } from "@/lib/entitlements";

/**
 * The customer's money: what the plan included, what the card wallet holds, and what each
 * generation actually cost.
 *
 * This exists because four billing endpoints have been live and finished for a while with no
 * caller anywhere in the app. A feature nobody can see is not a feature, and a wallet nobody
 * can fund is a one-way door.
 */

type Allowance = {
	accountId: number;
	month: string;
	tier: string;
	grantedRon: number;
	spentRon: number;
	remainingRon: number;
	resetAt: string;
};

type AutoRefill = {
	enabled: boolean;
	targetRon: number;
	lastTopUpAt: string | null;
	lastAmountRon: number | null;
	reason: string | null;
};

type UsageRow = {
	modelKey: string;
	label: string;
	inputTokens: number;
	outputTokens: number;
	costRon: number;
	allowanceAppliedRon: number;
	uncoveredRon: number;
	metered: boolean;
	createdAt: string;
};

type Balance = {
	balanceRon: number;
	lifetimeSpentRon: number;
	lifetimeTopupRon: number;
	canGenerate: boolean;
	minBalanceRon: number;
	minBalanceIsCustom: boolean;
	maxBalanceRon: number;
	autoRefill: AutoRefill;
	allowance: Allowance | null;
	recent: UsageRow[];
};

const ron = (value: number) =>
	`${Number(value || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} RON`;

const pct = (part: number, whole: number) => {
	if (!(whole > 0)) return 0;
	return Math.max(0, Math.min(100, (part / whole) * 100));
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="card billing-card">
			<h3 className="billing-card__title">{title}</h3>
			{children}
		</div>
	);
}

/**
 * A labelled meter.
 *
 * `warn` is used when the number is low enough that the customer should act before it runs
 * out rather than after, which is the whole reason a meter exists.
 */
function Meter({
	label,
	value,
	total,
	warn,
}: {
	label: string;
	value: number;
	total: number;
	warn?: boolean;
}) {
	const filled = pct(value, total);
	return (
		<div className="billing-meter">
			<div className="billing-meter__row">
				<span>{label}</span>
				<span className={warn ? "billing-meter__value billing-meter__value--warn" : "billing-meter__value"}>
					{ron(value)}
					{total > 0 && <em> of {ron(total)}</em>}
				</span>
			</div>
			<div className="billing-meter__track">
				<div
					className={warn ? "billing-meter__fill billing-meter__fill--warn" : "billing-meter__fill"}
					style={{ width: `${filled}%` }}
				/>
			</div>
		</div>
	);
}

export function BillingSection() {
	const [balance, setBalance] = useState<Balance | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [topUp, setTopUp] = useState("30");
	const [busy, setBusy] = useState(false);

	// The fetch is kept separate from the state updates so both callers can decide when to
	// apply the result: the effect below and the retry/top-up handlers have different rules
	// about when it is legal to set state.
	const fetchBalance = useCallback(async (): Promise<Balance> => {
		const res = await fetch("/api/billing/balance", { credentials: "include", cache: "no-store" });
		if (!res.ok) throw new Error(`The balance service answered ${res.status}.`);
		return (await res.json()) as Balance;
	}, []);

	const applyError = useCallback((err: unknown) => {
		// Shown rather than swallowed. A money page that renders an empty card because the
		// fetch failed is indistinguishable from an account that has spent nothing.
		setError(err instanceof Error ? err.message : "Could not load your balance.");
		setLoading(false);
	}, []);

	// Used by the retry button and after a top-up, both of which are user actions.
	const reload = useCallback(async () => {
		try {
			setBalance(await fetchBalance());
			setError(null);
		} catch (err) {
			applyError(err);
		} finally {
			setLoading(false);
		}
	}, [fetchBalance, applyError]);

	useEffect(() => {
		// State is applied in the promise callbacks rather than in the effect body: an effect
		// that sets state synchronously cascades a render before the browser has painted, and
		// the failure is invisible until it turns into a flicker under load.
		let cancelled = false;
		fetchBalance().then(
			(data) => {
				if (cancelled) return;
				setBalance(data);
				setError(null);
				setLoading(false);
			},
			(err: unknown) => {
				if (cancelled) return;
				applyError(err);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [fetchBalance, applyError]);

	async function submitTopUp() {
		const amount = Number(topUp);
		if (!(amount > 0)) {
			setError("Enter an amount greater than zero.");
			return;
		}
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const res = await fetch("/api/billing/fund", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ amountRon: amount }),
			});
			const data = (await res.json()) as Record<string, unknown>;
			if (!res.ok) {
				// The backend refuses to mint money with nothing to charge, and says why.
				// Passing that through is more useful than a generic failure.
				setError(String(data.message ?? data.error ?? `Top-up refused (${res.status}).`));
				return;
			}
			const added = Number(data.addedRon ?? 0);
			setNotice(
				added > 0
					? `Added ${ron(added)}. Your balance is now ${ron(Number(data.balanceRon ?? 0))}.`
					: `Your balance is already at the ${ron(Number(data.maxBalanceRon ?? 0))} ceiling, so nothing was added.`,
			);
			await reload();
		} catch {
			setError("The top-up could not be completed. Nothing was charged.");
		} finally {
			setBusy(false);
		}
	}

	if (loading) {
		return (
			<div className="tab-pane fade-in">
				<div className="card billing-card">
					<p className="billing-muted">Loading your balance…</p>
				</div>
			</div>
		);
	}

	if (!balance) {
		return (
			<div className="tab-pane fade-in">
				<div className="card billing-card">
					<p className="billing-error">{error ?? "Could not load your balance."}</p>
					<button className="btn-secondary" onClick={() => void reload()}>
						<RefreshIcon size={16} /> Try again
					</button>
				</div>
			</div>
		);
	}

	const allowance = balance.allowance;
	const refill = balance.autoRefill;
	const recent = balance.recent ?? [];
	// The funded wallet is a Spectre feature. The backend refuses a top-up below MAX, so the
	// form is hidden rather than shown to produce a 403 on submit.
	const spectre = tierCanUsePlayground(allowance?.tier ?? null);
	// A fifth of the way through is the point where "you are nearly out" is more useful than
	// "you have some". Deliberately not zero: a meter that only alarms at empty is an outage
	// with a progress bar.
	const allowanceWarn = allowance ? allowance.remainingRon <= allowance.grantedRon * 0.2 : false;

	return (
		<div className="tab-pane fade-in">
			{error && (
				<div className="billing-banner billing-banner--error">
					<TriangleAlertIcon size={18} /> {error}
				</div>
			)}
			{notice && (
				<div className="billing-banner billing-banner--ok">
					<CreditCard size={18} /> {notice}
				</div>
			)}

			<Card title="This month&apos;s included usage">
				{allowance ? (
					<>
						<Meter
							label={`Used on your ${allowance.tier} plan`}
							value={allowance.spentRon}
							total={allowance.grantedRon}
							warn={allowanceWarn}
						/>
						<dl className="billing-facts">
							<div>
								<dt>Left this month</dt>
								<dd>{ron(allowance.remainingRon)}</dd>
							</div>
							<div>
								<dt>Resets</dt>
								<dd>{new Date(allowance.resetAt).toLocaleDateString()}</dd>
							</div>
						</dl>
					</>
				) : (
					<p className="billing-muted">No allowance is recorded for this account yet.</p>
				)}
			</Card>

			<Card title="Card wallet">
				<div className="billing-wallet">
					<div className="billing-wallet__figure">
						<CreditCard size={22} />
						<span>{ron(balance.balanceRon)}</span>
					</div>
					<p className="billing-muted">
						Your included usage is spent first, and the wallet covers anything beyond it.
					</p>

					<dl className="billing-facts">
						<div>
							<dt>Spent for lifetime</dt>
							<dd>{ron(balance.lifetimeSpentRon)}</dd>
						</div>
						<div>
							<dt>Added for lifetime</dt>
							<dd>{ron(balance.lifetimeTopupRon)}</dd>
						</div>
						<div>
							<dt>Stops at</dt>
							<dd>{ron(balance.maxBalanceRon)}</dd>
						</div>
						<div>
							<dt>Refills below</dt>
							<dd>{ron(balance.minBalanceRon)}</dd>
						</div>
					</dl>

					<div className={refill.enabled ? "billing-refill" : "billing-refill billing-refill--off"}>
						<strong>{refill.enabled ? "Automatic refill is on" : "Automatic refill is off"}</strong>
						{refill.enabled ? (
							<p className="billing-muted">
								When your balance reaches {ron(balance.minBalanceRon)} it is topped up to{" "}
								{ron(refill.targetRon)} on your default card
								{refill.lastTopUpAt
									? `. Last time: ${new Date(refill.lastTopUpAt).toLocaleString()} for ${ron(
											refill.lastAmountRon ?? 0,
										)}.`
									: ". It has not been needed yet."}
							</p>
						) : (
							<p className="billing-muted">
								There is no default card on this account, so there is nothing to refill from. Add
								one to turn this on.
							</p>
						)}
					</div>

					<div className="billing-topup">
						<label htmlFor="billing-topup-amount">Add funds (RON)</label>
						{spectre ? (
							<>
								<div className="billing-topup__row">
									<input
										id="billing-topup-amount"
										type="number"
										min="1"
										step="1"
										value={topUp}
										onChange={(e) => setTopUp(e.target.value)}
										disabled={busy}
									/>
									<button className="btn-primary" onClick={() => void submitTopUp()} disabled={busy}>
										{busy ? "Adding…" : "Add funds"}
									</button>
								</div>
								<p className="billing-muted">
									Refills automatically to {ron(balance.autoRefill.targetRon)} whenever the balance
									reaches {ron(balance.minBalanceRon)}.
								</p>
							</>
						) : (
							/* Hidden rather than shown-and-refused. The form would only exist to
							   produce a 403 on submit, and offering a purchase the account cannot
							   make is worse than not offering it. The wallet is a Spectre feature. */
							<p className="billing-muted">
								The AI wallet comes with the Spectre plan. Upgrade to Max or Ultimate to add
								funds and have them refill automatically.
							</p>
						)}
					</div>
				</div>
			</Card>

			<Card title="Recent spend">
				{recent.length === 0 ? (
					<p className="billing-muted">Nothing metered yet. Your next answer will appear here.</p>
				) : (
					<table className="billing-table">
						<thead>
							<tr>
								<th scope="col">When</th>
								<th scope="col">Model</th>
								<th scope="col">Tokens</th>
								<th scope="col">Cost</th>
							</tr>
						</thead>
						<tbody>
							{recent.map((row, i) => (
								<tr key={`${row.createdAt}-${i}`}>
									<td>{new Date(row.createdAt).toLocaleString()}</td>
									<td>{row.label}</td>
									<td>
										{row.inputTokens.toLocaleString()} / {row.outputTokens.toLocaleString()}
									</td>
									<td>
										{ron(row.costRon)}
										{row.uncoveredRon > 0 && (
											<em className="billing-uncovered">
												{ron(row.uncoveredRon)} not charged
											</em>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
				<p className="billing-muted billing-footnote">
					A zero-token row is a fallback answer: it was produced without running a model, so there
					was nothing to charge for.
				</p>
			</Card>
		</div>
	);
}