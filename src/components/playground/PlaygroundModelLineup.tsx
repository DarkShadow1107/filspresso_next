"use client";

import { useEffect, useId, useState } from "react";
import {
	MODEL_CONTEXT_TOKENS,
	MODEL_DESCRIPTION_BY_KEY,
	MODEL_LABEL_BY_KEY,
	MODEL_MODALITY_BY_KEY,
	PLAYGROUND_MODEL_KEYS,
	formatContextTokens,
	isSelectablePlaygroundModelKey,
	normalizeModelTier,
	type ModelKey,
	type UserSubscriptionTier,
} from "@/lib/modelAccess";
import BrandLiquidIcon from "@/icons/brand-liquid-icon";
import LockIcon from "@/icons/lock-icon";
import { ArrowNarrowDownIcon } from "@/icons";

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
 *
 * ## Why this is a submenu
 *
 * It used to be a card at the foot of the page, always open, so the Playground's own
 * controls were pushed below a table of six models the customer cannot use. It is now a
 * disclosure under the model picker: the picker is what you use, the lineup is what you
 * look at when you want to know what else there is.
 */

type Price = { inputPer1M: number; outputPer1M: number; longContextPricing: boolean };
type HistoricalPrice = { modelKey: string; label: string; inputPer1M: number; outputPer1M: number; longContextPricing: boolean };

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
const LINEUP: ModelKey[] = [...PLAYGROUND_MODEL_KEYS];

const MODALITY_LABEL: Record<string, string> = {
	text: "Text",
	vision: "Vision",
	audio: "Audio",
	omni: "Omni",
};

export default function PlaygroundModelLineup({
	tier,
	access = "none",
	/** Only text models can be selected in the Playground. */
	textOnly = false,
	compact = false,
	/** Start open. The Playground's own copy opens it; the paywall's does not. */
	defaultOpen = false,
	disclosure = true,
}: {
	tier: UserSubscriptionTier | null;
	/** Defaults to the tier's implication, so a caller that has not resolved the real answer degrades conservatively. */
	access?: SpectreAccessState;
	textOnly?: boolean;
	compact?: boolean;
	defaultOpen?: boolean;
	disclosure?: boolean;
}) {
	const resolved = normalizeModelTier(tier ?? "none");
	const rows = LINEUP.filter((key) => !textOnly || MODEL_MODALITY_BY_KEY[key] === "text");
	const [open, setOpen] = useState(defaultOpen);
	const panelId = useId();

	// Absent prices are simply not shown. A placeholder like "--" next to every row would be
	// worse than a missing number: it reads as a price nobody has set yet.
	const [prices, setPrices] = useState<Record<string, Price>>({});
	const [historicalPrices, setHistoricalPrices] = useState<HistoricalPrice[]>([]);
	const [longContextMultiplier, setLongContextMultiplier] = useState(2);
	const [longContextThresholdTokens, setLongContextThresholdTokens] = useState(131_072);
	useEffect(() => {
		let cancelled = false;
		fetch("/api/billing/pricing?audience=api", { credentials: "include", cache: "no-store" })
			.then((res) => (res.ok ? res.json() : null))
			.then((body: {
				models?: Array<{ modelKey: string; inputPer1M: number; outputPer1M: number; longContextPricing?: boolean }>;
				historicalModels?: HistoricalPrice[];
				longContextMultiplier?: number;
				longContextThresholdTokens?: number;
			} | null) => {
				if (cancelled || !body?.models) return;
				const next: Record<string, Price> = {};
				for (const m of body.models) {
					next[m.modelKey] = {
						inputPer1M: m.inputPer1M,
						outputPer1M: m.outputPer1M,
						longContextPricing: m.longContextPricing === true,
					};
				}
				setPrices(next);
				setHistoricalPrices((body.historicalModels ?? []).filter((item) =>
					!textOnly || (!/\b(?:VL|Audio)\b/i.test(item.label)),
				));
				if (body.longContextMultiplier === 2) setLongContextMultiplier(2);
				if (Number.isSafeInteger(body.longContextThresholdTokens) && Number(body.longContextThresholdTokens) > 0)
					setLongContextThresholdTokens(Number(body.longContextThresholdTokens));
			})
			.catch(() => {
				// Deliberately silent: nothing is charged from these numbers, and the lineup is
				// still useful without them.
			});
		return () => {
			cancelled = true;
		};
	}, [textOnly]);

	const hasAccess = access !== "none";

	return (
		<section className={`pgm-lineup${compact ? " pgm-lineup-compact" : ""}${!disclosure ? " pgm-lineup-static" : ""}`} aria-label="Model lineup" data-tier={resolved}>
			{disclosure ? <button
				type="button"
				className="pgm-lineup-toggle"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => setOpen((value) => !value)}
			>
				<span className="pgm-lineup-toggle-label">API Prices</span>
				<ArrowNarrowDownIcon size={14} className="pgm-lineup-chevron" />
			</button> : <h2 className="pgm-lineup-title">Model lineup</h2>}

			<div id={panelId} className="pgm-lineup-panel" hidden={disclosure && !open}>
				<ul className="pgm-lineup-list">
					{rows.map((key) => {
						// Inside the Playground, model choice is a budget decision rather than a
						// tier one: every model is charged at its API price, so anyone with access
						// may run any current model. Historical LFM 2.5 prices remain visible but
						// those models cannot be selected for a new Playground turn.
						const selectable = isSelectablePlaygroundModelKey(key);
						const historical = !selectable;
						const included = hasAccess && selectable;

						return (
							<li key={key} className="pgm-lineup-row" data-included={included} data-historical={historical}>
								<span className="pgm-lineup-head">
									<span className="pgm-lineup-icon">
										<BrandLiquidIcon size={16} />
									</span>
									<span className="pgm-lineup-main">
										<span className="pgm-lineup-name">{MODEL_LABEL_BY_KEY[key]}</span>
										<span className="pgm-lineup-desc">{MODEL_DESCRIPTION_BY_KEY[key]}</span>
									</span>
								</span>
								<span className="pgm-lineup-meta">
									<span className="pgm-lineup-modality">
										{MODALITY_LABEL[MODEL_MODALITY_BY_KEY[key]] ?? key}
									</span>
									{/* The context window is what bounds the reply length, so it
									    belongs next to the model rather than only in the
									    max-tokens control. */}
									<span className="pgm-lineup-context">
										{formatContextTokens(MODEL_CONTEXT_TOKENS[key])} ctx
									</span>
									{prices[key] && (
										<span
											className="pgm-lineup-price"
											title={
												`API rate per 1M tokens. Up to ${formatContextTokens(longContextThresholdTokens)} input: ${prices[key].inputPer1M.toFixed(2)} RON input / ` +
												`${prices[key].outputPer1M.toFixed(2)} RON output.` +
												(prices[key].longContextPricing
													? ` Above ${formatContextTokens(longContextThresholdTokens)} input: ${(prices[key].inputPer1M * longContextMultiplier).toFixed(2)} RON input / ${(prices[key].outputPer1M * longContextMultiplier).toFixed(2)} RON output for the whole request.`
													: "")
											}
										>
											<span>≤{formatContextTokens(longContextThresholdTokens)} · <b>{prices[key].inputPer1M.toFixed(2)} / {prices[key].outputPer1M.toFixed(2)} RON</b></span>
											{prices[key].longContextPricing && <span>&gt;{formatContextTokens(longContextThresholdTokens)} · <b>{(prices[key].inputPer1M * longContextMultiplier).toFixed(2)} / {(prices[key].outputPer1M * longContextMultiplier).toFixed(2)} RON</b></span>}
											<small>API · per 1M input / output</small>
										</span>
									)}
									{historical ? (
										<span className="pgm-lineup-state pgm-lineup-state-history" aria-label="Historical rate, model not selectable">
											Historical · not selectable
										</span>
									) : included ? null : (
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
					{historicalPrices.map((price) => (
						<li key={price.modelKey} className="pgm-lineup-row" data-included="false" data-historical="true">
							<span className="pgm-lineup-head">
								<span className="pgm-lineup-icon"><BrandLiquidIcon size={16} /></span>
								<span className="pgm-lineup-main">
									<span className="pgm-lineup-name">{price.label}</span>
									<span className="pgm-lineup-desc">Previous LFM 2.5 API rate · unavailable for new Playground turns.</span>
								</span>
							</span>
							<span className="pgm-lineup-meta">
								<span className="pgm-lineup-context">Historical</span>
								<span className="pgm-lineup-price">
									<span>≤{formatContextTokens(longContextThresholdTokens)} · <b>{price.inputPer1M.toFixed(2)} / {price.outputPer1M.toFixed(2)} RON</b></span>
									<small>API · per 1M input / output</small>
								</span>
								<span className="pgm-lineup-state pgm-lineup-state-history">Historical · not selectable</span>
							</span>
						</li>
					))}
				</ul>
				<p className="pgm-lineup-foot">
					The &gt;{formatContextTokens(longContextThresholdTokens)} rate applies to the whole request when input exceeds {formatContextTokens(longContextThresholdTokens)}. Historical LFM 2.5 rates are shown for reference only; only LFM 3 models can be selected.
				</p>
			</div>
		</section>
	);
}

export { LINEUP as PLAYGROUND_MODEL_LINEUP };
