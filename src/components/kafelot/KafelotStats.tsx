import React from "react";

type KafelotStatsProps = {
	stats: {
		categoryCounts: { coffee: number; chemistry: number; general: number };
		total: number;
	};
};

export default function KafelotStats({ stats }: KafelotStatsProps) {
	return (
		<div className="stats-section fade-in">
			<h4>📊 Usage by Category</h4>
			<div className="stats-grid">
				<div className="stat-card">
					<div className="stat-icon">☕</div>
					<div className="stat-value">{stats.categoryCounts.coffee}</div>
					<div className="stat-label">Coffee</div>
				</div>
				<div className="stat-card">
					<div className="stat-icon">🧪</div>
					<div className="stat-value">{stats.categoryCounts.chemistry}</div>
					<div className="stat-label">Chemistry</div>
				</div>
				<div className="stat-card">
					<div className="stat-icon">🤖</div>
					<div className="stat-value">{stats.categoryCounts.general}</div>
					<div className="stat-label">General</div>
				</div>
			</div>
			<div className="stat-total">
				<span>Total Conversations:</span>
				<strong>{stats.total}</strong>
			</div>
		</div>
	);
}
