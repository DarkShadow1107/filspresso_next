import React from "react";

type KafelotUsageProps = {
	stats: {
		modelPercentages: { tanka: number; villanelle: number; ode: number };
	};
};

export default function KafelotUsage({ stats }: KafelotUsageProps) {
	return (
		<div className="stats-section fade-in" style={{ animationDelay: "0.1s" }}>
			<h4>🧠 Model Usage</h4>
			<div className="usage-mini-window">
				<div className="usage-bar-container">
					<div className="usage-bar-label">
						<span>🌿 Tanka</span>
						<span>{stats.modelPercentages.tanka}%</span>
					</div>
					<div className="usage-bar">
						<div className="usage-fill tanka" style={{ width: `${stats.modelPercentages.tanka}%` }} />
					</div>
				</div>
				<div className="usage-bar-container">
					<div className="usage-bar-label">
						<span>⚡ Villanelle</span>
						<span>{stats.modelPercentages.villanelle}%</span>
					</div>
					<div className="usage-bar">
						<div className="usage-fill villanelle" style={{ width: `${stats.modelPercentages.villanelle}%` }} />
					</div>
				</div>
				<div className="usage-bar-container">
					<div className="usage-bar-label">
						<span>🎼 Ode</span>
						<span>{stats.modelPercentages.ode}%</span>
					</div>
					<div className="usage-bar">
						<div className="usage-fill ode" style={{ width: `${stats.modelPercentages.ode}%` }} />
					</div>
				</div>
			</div>
		</div>
	);
}
