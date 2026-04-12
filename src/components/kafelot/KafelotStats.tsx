import React from "react";
import { CoffeeIcon, SparklesIcon, CpuIcon, ChartBarIcon, MessageCircleIcon, HistoryCircleIcon } from "@/icons";

type KafelotStatsProps = {
	stats: {
		categoryCounts: { coffee: number; chemistry: number; general: number };
		totalConversations: number;
		prompts: {
			general: {
				scopeLabel: string;
				used: number;
				remaining: number;
				limit: number;
				usagePercent: number;
				resetDate: string | null;
			};
			moleculeHelper: {
				scopeLabel: string;
				used: number;
				remaining: number;
				limit: number;
				usagePercent: number;
				resetDate: string | null;
			} | null;
		};
		memory: {
			used: number;
			remaining: number;
			limit: number;
			usagePercent: number;
		};
	};
};

export default function KafelotStats({ stats }: KafelotStatsProps) {
	const memoryOverflow = Math.max(0, stats.memory.used - stats.memory.limit);

	return (
		<div className="stats-section fade-in">
			<h4 className="flex items-center gap-2">
				<ChartBarIcon size={18} /> Usage by Category
			</h4>
			<div className="stats-grid">
				<div className="stat-card">
					<div className="stat-icon flex items-center justify-center">
						<CoffeeIcon size={24} />
					</div>
					<div className="stat-value">{stats.categoryCounts.coffee}</div>
					<div className="stat-label">Coffee</div>
				</div>
				<div className="stat-card">
					<div className="stat-icon flex items-center justify-center">
						<SparklesIcon size={24} />
					</div>
					<div className="stat-value">{stats.categoryCounts.chemistry}</div>
					<div className="stat-label">Chemistry</div>
				</div>
				<div className="stat-card">
					<div className="stat-icon flex items-center justify-center">
						<CpuIcon size={24} />
					</div>
					<div className="stat-value">{stats.categoryCounts.general}</div>
					<div className="stat-label">General</div>
				</div>
			</div>

			<div className="resource-grid">
				<div className="resource-card">
					<div className="resource-head">
						<span className="flex items-center gap-2">
							<MessageCircleIcon size={14} /> Prompts ({stats.prompts.general.scopeLabel})
						</span>
						<strong>
							{stats.prompts.general.used}/{stats.prompts.general.limit}
						</strong>
					</div>
					<div className="resource-meter">
						<div className="resource-fill prompts" style={{ width: `${stats.prompts.general.usagePercent}%` }} />
					</div>
					<div className="resource-meta">{stats.prompts.general.remaining} prompts remaining</div>
				</div>

				{stats.prompts.moleculeHelper && (
					<div className="resource-card">
						<div className="resource-head">
							<span className="flex items-center gap-2">
								<MessageCircleIcon size={14} /> Prompts ({stats.prompts.moleculeHelper.scopeLabel})
							</span>
							<strong>
								{stats.prompts.moleculeHelper.used}/{stats.prompts.moleculeHelper.limit}
							</strong>
						</div>
						<div className="resource-meter">
							<div
								className="resource-fill prompts-molecule"
								style={{ width: `${stats.prompts.moleculeHelper.usagePercent}%` }}
							/>
						</div>
						<div className="resource-meta">{stats.prompts.moleculeHelper.remaining} prompts remaining</div>
					</div>
				)}

				<div className="resource-card">
					<div className="resource-head">
						<span className="flex items-center gap-2">
							<HistoryCircleIcon size={14} /> Memory Conversations
						</span>
						<strong>
							{stats.memory.used}/{stats.memory.limit}
						</strong>
					</div>
					<div className="resource-meter">
						<div className="resource-fill memory" style={{ width: `${stats.memory.usagePercent}%` }} />
					</div>
					<div className="resource-meta">
						{memoryOverflow > 0
							? `${memoryOverflow} conversations above plan`
							: `${stats.memory.remaining} slots left`}
					</div>
				</div>
			</div>

			<div className="stat-total">
				<span>Total Conversations:</span>
				<strong>{stats.totalConversations}</strong>
			</div>
		</div>
	);
}
