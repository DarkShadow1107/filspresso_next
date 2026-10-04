import React from "react";
import { BrandLiquidIcon, CameraIcon, CpuIcon, SparklesIcon } from "@/icons";

type ModelUsageKey = "lfm2" | "lfm2Thinking" | "lfm2Vision" | "lfm2Audio" | "other";

type KafelotUsageProps = {
	stats: {
		modelPromptUsage: {
			labels: Record<ModelUsageKey, string>;
			counts: Record<ModelUsageKey, number>;
			percentages: Record<ModelUsageKey, number>;
			totalResponses: number;
		};
	};
};

const MODEL_ORDER: Array<{ key: ModelUsageKey; toneClass: string }> = [
	{ key: "lfm2", toneClass: "lfm" },
	{ key: "lfm2Thinking", toneClass: "lfm" },
	{ key: "lfm2Vision", toneClass: "vision" },
	{ key: "lfm2Audio", toneClass: "vision" },
	{ key: "other", toneClass: "other" },
];

function modelIcon(modelKey: ModelUsageKey) {
	if (modelKey === "lfm2") return <BrandLiquidIcon size={14} />;
	if (modelKey === "lfm2Thinking") return <BrandLiquidIcon size={14} />;
	if (modelKey === "lfm2Vision") return <CameraIcon size={14} />;
	if (modelKey === "lfm2Audio") return <SparklesIcon size={14} />;
	return <SparklesIcon size={14} />;
}

export default function KafelotUsage({ stats }: KafelotUsageProps) {
	return (
		<div className="stats-section fade-in" style={{ animationDelay: "0.1s" }}>
			<h4 className="flex items-center gap-2">
				<CpuIcon size={18} /> Model Usage
			</h4>
			<div className="usage-mini-window">
				{MODEL_ORDER.map((entry) => {
					const count = stats.modelPromptUsage.counts[entry.key] || 0;
					const percentage = stats.modelPromptUsage.percentages[entry.key] || 0;
					const fillWidth = count > 0 ? Math.max(percentage, 4) : 0;

					return (
						<div className="usage-bar-container" key={entry.key}>
							<div className="usage-bar-label flex items-center justify-between w-full">
								<span className="flex items-center gap-2">
									{modelIcon(entry.key)} {stats.modelPromptUsage.labels[entry.key]}
								</span>
								<span>
									{count} ({percentage.toFixed(2)}%)
								</span>
							</div>
							<div className="usage-bar">
								<div className={`usage-fill ${entry.toneClass}`} style={{ width: `${fillWidth}%` }} />
							</div>
						</div>
					);
				})}
				<div className="stat-total" style={{ marginTop: "8px" }}>
					<span>Total AI Responses:</span>
					<strong>{stats.modelPromptUsage.totalResponses}</strong>
				</div>
			</div>
		</div>
	);
}
