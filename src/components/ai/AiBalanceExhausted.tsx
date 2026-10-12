"use client";

import { useRouter } from "next/navigation";
import { TriangleAlertIcon } from "@/icons";

/**
 * Shown when the AI allowance and the wallet are both spent.
 *
 * This exists because the gate did its job and the customer had nowhere to go. The backend
 * answers a 402 with what it knows -- remaining allowance, wallet balance, and whether the
 * likely action is a top-up or an upgrade -- so this renders what the server decided rather
 * than guessing from a status code.
 *
 * Deliberately not an error toast. The state is correct and expected; it is what a prepaid
 * meter looks like at the end of a month's money, and treating it as a failure teaches
 * customers that the product is broken.
 */
export type BalanceGate = {
	allowanceRemainingRon: number;
	balanceRon: number;
	/** True when the wallet can be funded at all, i.e. the plan is Spectre. */
	canFund?: boolean;
};

export function AiBalanceExhausted({ gate }: { gate: BalanceGate }) {
	const router = useRouter();
	const { allowanceRemainingRon: allowance, balanceRon: balance } = gate;
	const nothingLeft = allowance <= 0 && balance <= 0;

	return (
		<div className="ai-balance-gate" role="status">
			<span className="ai-balance-gate__icon">
				<TriangleAlertIcon size={20} />
			</span>
			<div className="ai-balance-gate__body">
				<strong>
					{nothingLeft
						? "You have used all your AI usage for this month"
						: "Your AI usage for this month is spent"}
				</strong>
				<p>
					{nothingLeft ? (
						<>
							Your monthly allowance and your wallet are both empty. Your usage resets on the
							first of next month
							{gate.canFund ? ", or you can add funds now" : ""}.
						</>
					) : (
						<>Your monthly allowance is spent. Add funds to keep going.</>
					)}
				</p>
				<div className="ai-balance-gate__actions">
					{gate.canFund ? (
						<button className="btn-primary" onClick={() => router.push("/api/pages/account?tab=billing")}>
							Add funds
						</button>
					) : null}
					<button className="btn-secondary" onClick={() => router.push("/api/pages/subscription")}>
						View plans
					</button>
				</div>
			</div>
		</div>
	);
}

/** Narrow the shape the 402 payloads share, tolerating absent fields. */
export function readBalanceGate(body: unknown): BalanceGate | null {
	if (!body || typeof body !== "object") return null;
	const b = body as Record<string, unknown>;
	if (b.error !== "INSUFFICIENT_BALANCE") return null;
	const allowance = Number(b.allowance_remaining_ron ?? 0);
	const balance = Number(b.balance_ron ?? 0);
	return {
		allowanceRemainingRon: Number.isFinite(allowance) ? allowance : 0,
		balanceRon: Number.isFinite(balance) ? balance : 0,
		canFund: b.action === "top_up" || b.action === "top_up_or_upgrade",
	};
}