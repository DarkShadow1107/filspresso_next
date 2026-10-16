"use client";

import { useEffect, useState } from "react";
import {
	MODEL_DESCRIPTION_BY_KEY,
	MODEL_LABEL_BY_KEY,
	MODEL_MODALITY_BY_KEY,
	normalizeModelTier,
	type ModelKey,
	type UserSubscriptionTier,
} from "@/lib/modelAccess";
import BrandLiquidIcon from "@/icons/brand-liquid-icon";
import LockIcon from "@/icons/lock-icon";

/**
 * The full model lineup, with each entry marked included or locked for a plan.
 *
 * The Playground's own `<select>` only lists what the current plan may run, which
 * is correct but gives a locked or lower-tier visitor no way to see what exists or
 * what an upgrade would add. This derives every row from the entitlement matrix so
 * the marketing surface cannot drift from what `/api/playground/chat` enforces.
 *
 * Prices are the public API list price, and they are labelled as such. The Playground
 * is list-priced for everyone -- a plan's allowance is not a discount on tokens -- so
 * these numbers are what a message actually costs regardless of who is paying.
 *
 * A row carries its price and, when the account cannot run it, a lock. That is the whole
 * surface on purpose: the table's job is to mirror the entitlement matrix, and the moment
 * it also quotes the subscription's price it becomes a second place for those terms to live
 * and go stale. They belong on the plans page, which is the one place they are sold.
 */

type Price = { inputPer1M: number; outputPer1M: number };

/**
 * How this account reached the Playground, or that it has not.
 *
 * Deliberately not the tier. Access comes from the Spectre subscription, from a bundled
 * Max/Ultimate tier, or from neither. Still needed even though the rows no longer spell it
 * out: it decides whether a plan's allowance covers a model, which changes how a message is
 * billed.
 */
export type SpectreAccessState = "addon" | "tier" | "none";

/** Cheapest first, so the list reads as a ladder. */
const LINEUP: ModelKey[] = [
	"lfm2_5_230m_q4_k_m",
	"lfm2_5_350m_q8_0",
	"lfm2_5_1_2b_instruct_q4_k_m",
	"lfm2_5_1_2b_thinking_q4_k_m",
	"lfm2_5_2_6b_q4_0",
	"lfm2_5_8b_a1b_q4_k_m",
];

/** Models a Max plan may run but not out of its allowance. See billing-context.ts. */
const ALLOWANCE_EXCLUDED: Partial<Record<UserSubscriptionTier, ReadonlySet<string>>> = {
	max: new Set(["lfm2_5_8b_a1b_q4_k_m"]),
};

const MODALITY_LABEL: Record<string, string> = {
	text: "Text",
	vision: "Vision",
	audio: "Audio",
};

export default function PlaygroundModelLineup({
	tier,
	access = "none",
	/** Only text models can be selected in the Playground. */
	textOnly = false,
	compact = false,
}: {
	tier: UserSubscriptionTier | null;
	/** Defaults to the tier's implication, so a caller that has not resolved the real answer degrades conservatively. */
	access?: SpectreAccessState;
	textOnly?: boolean;
	compact?: boolean;
}) {
	const resolved = normalizeModelTier(tier ?? "none");
	const rows = LINEUP.filter((key) => !textOnly || MODEL_MODALITY_BY_KEY[key] === "text");

	// Absent prices are simply not shown. A placeholder like "--" next to every row would be
	// worse than a missing number: it reads as a price nobody has set yet.
	const [prices, setPrices] = useState<Record<string, Price>>({});
	useEffect(() => {
		let cancelled = false;
		fetch("/api/billing/pricing?audience=api", { credentials: "include", cache: "no-store" })
			.then((res) => (res.ok ? res.json() : null))
			.then((body: { models?: Array<{ modelKey: string } & Price> } | null) => {
				if (cancelled || !body?.models) return;
				const next: Record<string, Price> = {};
				for (const m of body.models) {
					next[m.modelKey] = { inputPer1M: m.inputPer1M, outputPer1M: m.outputPer1M };
				}
				setPrices(next);
			})
			.catch(() => {
				// Deliberately silent: nothing is charged from these numbers, and the lineup is
				// still useful without them.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const hasAccess = access !== "none";

	return (
		<section className={`pgm-lineup${compact ? " pgm-lineup-compact" : ""}`} aria-label="Model lineup">
			{!compact ? <h2 className="pgm-lineup-title">Model lineup</h2> : null}
			<ul className="pgm-lineup-list">
				{rows.map((key) => {
					// Inside the Playground, model choice is a budget decision rather than a
					// tier one: every model is charged at its API price, so anyone with access
					// may run any of them. Kafelot keeps its own tier ladder -- the two surfaces
					// are entitled differently on purpose.
					const included = hasAccess;
					const excludedFromAllowance =
						access === "tier" && Boolean(ALLOWANCE_EXCLUDED[resolved]?.has(key));

					return (
						<li key={key} className="pgm-lineup-row" data-included={included}>
							<span className="pgm-lineup-icon">
								<BrandLiquidIcon size={16} />
							</span>
							<span className="pgm-lineup-main">
								<span className="pgm-lineup-name">{MODEL_LABEL_BY_KEY[key]}</span>
								<span className="pgm-lineup-desc">{MODEL_DESCRIPTION_BY_KEY[key]}</span>
							</span>
							<span className="pgm-lineup-meta">
								<span className="pgm-lineup-modality">
									{MODALITY_LABEL[MODEL_MODALITY_BY_KEY[key]] ?? key}
								</span>
								{prices[key] && (
									<span
										className="pgm-lineup-price"
										title={
											`API list price: ${prices[key].inputPer1M.toFixed(2)} RON per 1M input tokens, ` +
											`${prices[key].outputPer1M.toFixed(2)} RON per 1M output tokens. This is what a message costs ` +
											`in the Playground, for every plan.` +
											// The one billing fact that is genuinely plan-specific, kept in the
											// tooltip rather than on the row: the line-up carries no plan copy at
											// all, so this is the only place a Max customer can find out that the
											// 8B will not come out of their allowance.
											(excludedFromAllowance
												? " Your plan's allowance does not cover this model -- usage is billed to your wallet."
												: "")
										}
									>
										API price
										<b>
											{prices[key].inputPer1M.toFixed(2)} / {prices[key].outputPer1M.toFixed(2)} RON
										</b>
									</span>
								)}
								{included ? null : (
									// A lock and nothing else. This table used to spell out the
									// subscription price and what usage would cost, which put the
									// add-on's commercial terms in a component whose only job is to
									// mirror the entitlement matrix -- two sources of truth for the same
									// numbers, one of them a copy-paste away from going stale.
									<span
										className="pgm-lineup-state pgm-lineup-state-out"
										title="Locked. Subscribe to the Spectre Playground to unlock every model here."
										aria-label="Locked"
									>
										<LockIcon size={13} />
									</span>
								)}
							</span>
						</li>
					);
				})}
			</ul>
			<p className="pgm-lineup-foot">
				{/* Only the operational note. The subscription's price and what usage costs
				    live on the plans page; repeating them here is how two pages end up
				    quoting different numbers. */}
				One model runs at a time on the Playground. Switching loads it first, and the progress bar
				shows how long that takes.
			</p>
		</section>
	);
}

export { LINEUP as PLAYGROUND_MODEL_LINEUP };