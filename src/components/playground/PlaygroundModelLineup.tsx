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
import { SPECTRE_SUBSCRIPTION } from "@/lib/entitlements";
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
 */

type Price = { inputPer1M: number; outputPer1M: number };

/**
 * How this account reached the Playground, or that it has not.
 *
 * Deliberately not the tier. Access now comes from the Spectre subscription, from a
 * bundled Max/Ultimate tier, or from neither, and the copy below says which -- because
 * "locked" tells a customer nothing about what would unlock it.
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

const ron = (value: number) =>
	`${Number(value || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`;

/** The cheapest plan that unlocks a model, for tier-based accounts. */
function lowestTierFor(modelKey: ModelKey): UserSubscriptionTier | null {
	const tiers: UserSubscriptionTier[] = ["free", "basic", "plus", "pro", "max", "ultimate"];
	// `none` is not a real plan, so it is never a starting point.
	for (const tier of tiers) {
		if (tierAllowsModel(tier, modelKey)) return tier;
	}
	return null;
}

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
					const from = lowestTierFor(key);

					let badge: React.ReactNode;
					if (!included) {
						badge = (
							<span className="pgm-lineup-state pgm-lineup-state-out">
								<LockIcon size={13} />
								<span className="pgm-lineup-state__stack">
									<b>Spectre subscription · {ron(SPECTRE_SUBSCRIPTION.monthlyRon)}/month</b>
									<em>model usage paid separately at API prices</em>
								</span>
							</span>
						);
					} else if (access === "addon") {
						// No allowance is included with the subscription, so saying "Included"
						// here would be the one thing this table must never say.
						badge = (
							<span className="pgm-lineup-state pgm-lineup-state-in pgm-lineup-state--metered">
								Pay per use
							</span>
						);
					} else if (excludedFromAllowance) {
						badge = (
							<span className="pgm-lineup-state pgm-lineup-state-out pgm-lineup-state--metered">
								Usage paid separately
							</span>
						);
					} else {
						badge = (
							<span className="pgm-lineup-state pgm-lineup-state-in">
								Included
							</span>
						);
					}

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
										title={`API list price: ${prices[key].inputPer1M.toFixed(2)} RON per 1M input tokens, ${prices[key].outputPer1M.toFixed(2)} RON per 1M output tokens. This is what a message costs in the Playground, for every plan.`}
									>
										API price
										<b>
											{prices[key].inputPer1M.toFixed(2)} / {prices[key].outputPer1M.toFixed(2)} RON
										</b>
									</span>
								)}
								{badge}
							</span>
						</li>
					);
				})}
			</ul>
			<p className="pgm-lineup-foot">
				{hasAccess ? (
					access === "addon" ? (
						<>
							Your Spectre subscription covers access to this Playground. Every message is metered at
							the API price shown above and billed to your wallet.
						</>
					) : (
						<>
							One model runs at a time on the Playground. Switching loads it first, and the
							progress bar shows how long that takes. Your monthly allowance covers usage; the
							LFM 2.5 8B on the Max plan is billed separately.
						</>
					)
				) : (
					<>
						Subscribe to the Spectre Playground for {ron(SPECTRE_SUBSCRIPTION.monthlyRon)} per month,
						or {ron(SPECTRE_SUBSCRIPTION.annualRon)} a year. Model usage is paid separately at API
						prices and is not included in the subscription.
					</>
				)}
			</p>
		</section>
	);
}

export { LINEUP as PLAYGROUND_MODEL_LINEUP };