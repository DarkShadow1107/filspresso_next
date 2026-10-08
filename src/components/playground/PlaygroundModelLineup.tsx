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
 */

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