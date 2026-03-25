import React from "react";
import { CpuIcon, BrandGeminiIcon } from "@/icons";

type KafelotUsageProps = {
	stats: {
		modelPercentages: { tanka: number };
	};
};

export default function KafelotUsage({ stats }: KafelotUsageProps) {
	return (
		<div className="stats-section fade-in" style={{ animationDelay: "0.1s" }}>
			<h4 className="flex items-center gap-2">
				<CpuIcon size={18} /> Model Usage
			</h4>
			<div className="usage-mini-window">
				<div className="usage-bar-container">
					<div className="usage-bar-label flex items-center justify-between w-full">
						<span className="flex items-center gap-2">
							<BrandGeminiIcon size={14} /> Tanka
						</span>
						<span>{stats.modelPercentages.tanka}%</span>
					</div>
					<div className="usage-bar">
						<div className="usage-fill tanka" style={{ width: `${stats.modelPercentages.tanka}%` }} />
					</div>
				</div>
			</div>
		</div>
	);
}
