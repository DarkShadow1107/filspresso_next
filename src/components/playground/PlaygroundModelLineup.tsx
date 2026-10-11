"use client";

import { useEffect, useState } from "react";
import {
	MODEL_DESCRIPTION_BY_KEY,
	MODEL_LABEL_BY_KEY,
	MODEL_MODALITY_BY_KEY,
	tierAllowsModel,
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
 * Prices are the public API list price, and they are labelled as such. A paying plan is
 * charged less, so presenting these numbers as what the visitor will pay would be a lie
 * told to exactly the people who would notice; the plan's own money is shown on the
 * account page, where it belongs.
 */

type Price = { inputPer1M: number; outputPer1M: number };

/** Cheapest first, so the list reads as a ladder. */
const LINEUP: ModelKey[] = [
	"lfm2_5_230m_q4_k_m",
	"lfm2_5_350m_q8_0",
	"lfm2_5_1_2b_instruct_q4_k_m",
	"lfm2_5_1_2b_thinking_q4_k_m",
	"lfm2_5_2_6b_q4_0",
	"lfm2_5_8b_a1b_q4_k_m",
];

const MODALITY_LABEL: Record<string, string> = {
	text: "Text",
	vision: "Vision",
	audio: "Audio",
};

/** The cheapest plan that unlocks a model, for the "from <plan>" column. */
function lowestTierFor(modelKey: ModelKey): UserSubscriptionTier | null {
	const tiers: UserSubscriptionTier[] = [
		"free",
		"basic",
		"plus",
		"pro",
		"max",
		"ultimate",
	];
	// `none` is not a real plan, so it is never a starting point.
	for (const tier of tiers) {
		if (tierAllowsModel(tier, modelKey)) return tier;
	}
	return null;
}

export default function PlaygroundModelLineup({
	tier,
	/** Only text models can be selected in the Playground. */
	textOnly = false,
	compact = false,
}: {
	tier: UserSubscriptionTier | null;
	textOnly?: boolean;
	compact?: boolean;
}) {
	const resolved = normalizeModelTier(tier ?? "none");
	const rows = LINEUP.filter(
		(key) => !textOnly || MODEL_MODALITY_BY_KEY[key] === "text",
	);

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
				// The lineup is still useful without prices, so a failure here is silent by
				// design. It is not a money path: nothing is charged from these numbers.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<section
			className={`pgm-lineup${compact ? " pgm-lineup-compact" : ""}`}
			aria-label="Model lineup"
		>
			{!compact ? <h2 className="pgm-lineup-title">Model lineup</h2> : null}
			<ul className="pgm-lineup-list">
				{rows.map((key) => {
					const included = tierAllowsModel(resolved, key);
					const from = lowestTierFor(key);
					return (
						<li
							key={key}
							className="pgm-lineup-row"
							data-included={included}
						>
							<span className="pgm-lineup-icon">
								<BrandLiquidIcon size={16} />
							</span>
							<span className="pgm-lineup-main">
								<span className="pgm-lineup-name">
									{MODEL_LABEL_BY_KEY[key]}
								</span>
								<span className="pgm-lineup-desc">
									{MODEL_DESCRIPTION_BY_KEY[key]}
								</span>
							</span>
							<span className="pgm-lineup-meta">
								<span className="pgm-lineup-modality">
									{MODALITY_LABEL[MODEL_MODALITY_BY_KEY[key]] ?? key}
								</span>
								{prices[key] && (
									<span
										className="pgm-lineup-price"
										title="Public API list price per million tokens. A paid plan is charged less; your own spend is on the account page."
									>
										{prices[key].inputPer1M.toFixed(2)} / {prices[key].outputPer1M.toFixed(2)} RON
										<em>per 1M in / out</em>
									</span>
								)}
								{included ? (
									<span className="pgm-lineup-state pgm-lineup-state-in">
										{/* No per-model quota any more. Spend is metered in RON against the
										    plan's monthly allowance, which works across every model, so
										    "120/mo" here would advertise a budget nothing enforces. */}
										Included
									</span>
								) : (
									<span className="pgm-lineup-state pgm-lineup-state-out">
										<LockIcon size={13} />
										{from ? `from ${from}` : "locked"}
									</span>
								)}
							</span>
						</li>
					);
				})}
			</ul>
			<p className="pgm-lineup-foot">
				One model runs at a time on the Playground. Switching loads it first, and
				the progress bar shows how long that takes.
			</p>
		</section>
	);
}

export { LINEUP as PLAYGROUND_MODEL_LINEUP };