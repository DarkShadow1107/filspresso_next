"use client";

import { CapsuleStats, TIER_BENEFITS, TIER_COLORS, TIER_THRESHOLDS, gradientTextStyle, ConsumptionHistory } from "./types";
import ConsumptionGraph, { GraphTheme } from "./ConsumptionGraph";

type HoveredGraphPoint = {
	x: number;
	y: number;
	value: number;
	date: string;
	type: string;
	color: string;
} | null;

type MemberStatusSectionProps = {
	isLoadingCapsuleStats: boolean;
	capsuleStats: CapsuleStats | null;
	consumptionHistory: ConsumptionHistory | null;
	hoveredGraphPoint: HoveredGraphPoint;
	setHoveredGraphPoint: (point: HoveredGraphPoint) => void;
	accountId?: number;
	graphTheme?: GraphTheme;
};

export function MemberStatusSection({
	isLoadingCapsuleStats,
	capsuleStats,
	consumptionHistory,
	hoveredGraphPoint,
	setHoveredGraphPoint,
	accountId,
	graphTheme = "classic",
}: MemberStatusSectionProps) {
	if (isLoadingCapsuleStats) {
		return (
			<div className="tab-pane fade-in">
				<div className="card" style={{ textAlign: "center", padding: "3rem", color: "#888" }}>
					<div
						style={{
							width: "30px",
							height: "30px",
							border: "3px solid #333",
							borderTopColor: "#c4a77d",
							borderRadius: "50%",
							animation: "spin 1s linear infinite",
							margin: "0 auto 1rem",
						}}
					/>
					Loading member status...
				</div>
			</div>
		);
	}

	if (!capsuleStats) {
		return (
			<div className="tab-pane fade-in">
				<div className="card" style={{ textAlign: "center", padding: "3rem" }}>
					<div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🏆</div>
					<p style={{ color: "#888", fontSize: "1.1rem", margin: "0 0 0.5rem 0" }}>Unable to load member status</p>
					<p style={{ color: "#666", fontSize: "0.9rem", margin: 0 }}>Please try again later</p>
				</div>
			</div>
		);
	}

	return (
		<div className="tab-pane fade-in">
			{/* Current Tier Card */}
			<div className="card" style={{ marginBottom: "1.5rem" }}>
				<div
					style={{
						background: TIER_COLORS[capsuleStats.currentTier.name]?.bg || "rgba(136, 136, 136, 0.15)",
						border: `1px solid ${TIER_COLORS[capsuleStats.currentTier.name]?.primary || "#888"}40`,
						borderRadius: "16px",
						padding: "2rem",
						textAlign: "center",
						position: "relative",
						overflow: "hidden",
					}}
				>
					{/* Decorative background */}
					<div
						style={{
							position: "absolute",
							top: 0,
							right: 0,
							width: "200px",
							height: "200px",
							background: `radial-gradient(circle at top right, ${
								TIER_COLORS[capsuleStats.currentTier.name]?.primary || "#888"
							}15, transparent 70%)`,
							pointerEvents: "none",
						}}
					/>

					{/* Tier Icon */}
					<div style={{ fontSize: "4rem", marginBottom: "0.5rem" }}>
						{TIER_BENEFITS[capsuleStats.currentTier.name]?.icon || "🌱"}
					</div>

					{/* Tier Name */}
					<h2
						style={{
							margin: "0 0 0.5rem",
							fontSize: "2rem",
							fontWeight: 700,
							background: `linear-gradient(135deg, ${
								TIER_COLORS[capsuleStats.currentTier.name]?.primary || "#888"
							}, ${TIER_COLORS[capsuleStats.currentTier.name]?.secondary || "#666"})`,
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
							backgroundClip: "text",
						}}
					>
						{capsuleStats.currentTier.name}
					</h2>

					{/* Capsules Count */}
					<div style={{ fontSize: "1rem", color: "#aaa", marginBottom: "1.5rem" }}>
						<span style={{ fontWeight: 600, color: "#e5e5e5", fontSize: "1.25rem" }}>
							{capsuleStats.currentPeriod.capsules.toLocaleString()}
						</span>{" "}
						capsules this membership year
					</div>

					{/* Progress to Next Tier */}
					{capsuleStats.nextTier && (
						<div style={{ maxWidth: "400px", margin: "0 auto" }}>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									marginBottom: "0.5rem",
									fontSize: "0.85rem",
								}}
							>
								<span style={{ color: "#888" }}>Progress to {capsuleStats.nextTier.name}</span>
								<span style={{ color: TIER_COLORS[capsuleStats.nextTier.name]?.primary || "#888" }}>
									{capsuleStats.nextTier.remaining.toLocaleString()} capsules to go
								</span>
							</div>
							<div
								style={{
									height: "12px",
									background: "#2a2a2a",
									borderRadius: "6px",
									overflow: "hidden",
									position: "relative",
								}}
							>
								{(() => {
									const currentThreshold = TIER_THRESHOLDS.find(
										(t) => t.tier === capsuleStats.currentTier.name
									);
									const nextThreshold = TIER_THRESHOLDS.find((t) => t.tier === capsuleStats.nextTier?.name);
									if (!currentThreshold || !nextThreshold) return null;

									const rangeStart = currentThreshold.min;
									const rangeEnd = nextThreshold.min;
									const currentInRange = capsuleStats.currentPeriod.capsules - rangeStart;
									const rangeSize = rangeEnd - rangeStart;
									const percentage = Math.min(100, (currentInRange / rangeSize) * 100);

									return (
										<div
											style={{
												height: "100%",
												width: `${percentage}%`,
												background: `linear-gradient(90deg, ${
													TIER_COLORS[capsuleStats.currentTier.name]?.primary || "#888"
												}, ${TIER_COLORS[capsuleStats.nextTier?.name || ""]?.primary || "#888"})`,
												borderRadius: "6px",
												transition: "width 0.5s ease",
											}}
										/>
									);
								})()}
							</div>
						</div>
					)}

					{/* At Max Tier */}
					{!capsuleStats.nextTier && (
						<div
							style={{
								background: "rgba(245, 158, 11, 0.1)",
								border: "1px solid rgba(245, 158, 11, 0.3)",
								borderRadius: "8px",
								padding: "0.75rem 1.5rem",
								display: "inline-block",
								color: "#f59e0b",
								fontWeight: 600,
							}}
						>
							👑 You've reached the highest tier!
						</div>
					)}

					{/* Days Remaining */}
					<div style={{ marginTop: "1.5rem", fontSize: "0.85rem", color: "#666" }}>
						{capsuleStats.currentPeriod.daysRemaining} days remaining in current membership year
					</div>
				</div>
			</div>

			{/* Tier Progress Overview */}
			<div className="card" style={{ marginBottom: "1.5rem" }}>
				<h2 style={{ marginBottom: "1.5rem" }}>🏅 Tier Progression</h2>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						position: "relative",
						padding: "0 1rem",
					}}
				>
					{/* Progress Line */}
					<div
						style={{
							position: "absolute",
							top: "50%",
							left: "2rem",
							right: "2rem",
							height: "4px",
							background: "#2a2a2a",
							transform: "translateY(-50%)",
							zIndex: 0,
						}}
					/>
					<div
						style={{
							position: "absolute",
							top: "50%",
							left: "2rem",
							width: `${Math.min(100, (capsuleStats.currentTier.level / 5) * 100)}%`,
							maxWidth: "calc(100% - 4rem)",
							height: "4px",
							background: `linear-gradient(90deg, ${TIER_COLORS.Connoisseur.primary}, ${
								TIER_COLORS[capsuleStats.currentTier.name]?.primary || "#888"
							})`,
							transform: "translateY(-50%)",
							zIndex: 1,
							transition: "width 0.5s ease",
						}}
					/>

					{/* Tier Nodes */}
					{Object.entries(TIER_BENEFITS).map(([tierName, tierInfo], index) => {
						const isCurrentOrPast = capsuleStats.currentTier.level >= index;
						const isCurrent = capsuleStats.currentTier.name === tierName;
						const colors = TIER_COLORS[tierName];
						const thresholds = ["0", "1+", "750+", "2000+", "4000+", "7000+"];

						return (
							<div
								key={tierName}
								style={{
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									position: "relative",
									zIndex: 2,
								}}
							>
								<div
									style={{
										width: isCurrent ? "56px" : "44px",
										height: isCurrent ? "56px" : "44px",
										borderRadius: "50%",
										background: isCurrentOrPast
											? `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`
											: "#2a2a2a",
										border: isCurrent ? "3px solid #fff" : "2px solid #333",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										fontSize: isCurrent ? "1.5rem" : "1.25rem",
										boxShadow: isCurrent ? `0 0 20px ${colors.primary}60` : "none",
										transition: "all 0.3s ease",
									}}
								>
									{tierInfo.icon}
								</div>
								<div
									style={{
										marginTop: "0.5rem",
										fontSize: "0.75rem",
										fontWeight: isCurrent ? 700 : 500,
										color: isCurrentOrPast ? colors.primary : "#666",
										textAlign: "center",
										maxWidth: "70px",
									}}
								>
									{tierName}
								</div>
								<div style={{ fontSize: "0.65rem", color: "#666", marginTop: "0.25rem" }}>
									{thresholds[index]}
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Current Tier Benefits */}
			<div className="card" style={{ marginBottom: "1.5rem" }}>
				<h2 style={{ marginBottom: "1rem" }}>
					{TIER_BENEFITS[capsuleStats.currentTier.name]?.icon} Your {capsuleStats.currentTier.name} Benefits
				</h2>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
						gap: "1rem",
					}}
				>
					{TIER_BENEFITS[capsuleStats.currentTier.name]?.benefits.map((benefit, index) => (
						<div
							key={index}
							style={{
								display: "flex",
								alignItems: "flex-start",
								gap: "0.75rem",
								padding: "1rem",
								background: "#1a1a1a",
								borderRadius: "10px",
								border: "1px solid #333",
							}}
						>
							<span
								style={{
									color: TIER_COLORS[capsuleStats.currentTier.name]?.primary || "#10b981",
									fontSize: "1.1rem",
									flexShrink: 0,
								}}
							>
								✓
							</span>
							<span style={{ color: "#ccc", fontSize: "0.95rem" }}>{benefit}</span>
						</div>
					))}
				</div>
			</div>

			{/* Stats Summary */}
			<div className="card" style={{ marginBottom: "1.5rem" }}>
				<h2 style={{ marginBottom: "1.5rem" }}>📊 Your Coffee Journey</h2>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
						gap: "1rem",
					}}
				>
					{/* Total Capsules All Time */}
					<div
						style={{
							background: "linear-gradient(135deg, rgba(196, 167, 125, 0.1) 0%, rgba(166, 124, 82, 0.1) 100%)",
							border: "1px solid rgba(196, 167, 125, 0.3)",
							borderRadius: "12px",
							padding: "1.5rem",
							textAlign: "center",
						}}
					>
						<div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>☕</div>
						<div style={{ fontSize: "2rem", fontWeight: 700, ...gradientTextStyle }}>
							{capsuleStats.totalCapsules.toLocaleString()}
						</div>
						<div style={{ fontSize: "0.9rem", color: "#888", marginTop: "0.25rem" }}>Total Capsules Ordered</div>
					</div>

					{/* Current Period */}
					<div
						style={{
							background: `${TIER_COLORS[capsuleStats.currentTier.name]?.bg || "rgba(136, 136, 136, 0.15)"}`,
							border: `1px solid ${TIER_COLORS[capsuleStats.currentTier.name]?.primary || "#888"}40`,
							borderRadius: "12px",
							padding: "1.5rem",
							textAlign: "center",
						}}
					>
						<div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📅</div>
						<div
							style={{
								fontSize: "2rem",
								fontWeight: 700,
								color: TIER_COLORS[capsuleStats.currentTier.name]?.primary || "#888",
							}}
						>
							{capsuleStats.currentPeriod.capsules.toLocaleString()}
						</div>
						<div style={{ fontSize: "0.9rem", color: "#888", marginTop: "0.25rem" }}>This Membership Year</div>
					</div>

					{/* Member Since */}
					<div
						style={{
							background: "rgba(59, 130, 246, 0.1)",
							border: "1px solid rgba(59, 130, 246, 0.3)",
							borderRadius: "12px",
							padding: "1.5rem",
							textAlign: "center",
						}}
					>
						<div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎂</div>
						<div style={{ fontSize: "2rem", fontWeight: 700, color: "#60a5fa" }}>
							{new Date(capsuleStats.accountCreatedAt).toLocaleDateString("en-US", {
								month: "short",
								year: "numeric",
							})}
						</div>
						<div style={{ fontSize: "0.9rem", color: "#888", marginTop: "0.25rem" }}>Member Since</div>
					</div>

					{/* Original Capsules */}
					<div
						style={{
							background: "rgba(196, 167, 125, 0.1)",
							border: "1px solid rgba(196, 167, 125, 0.3)",
							borderRadius: "12px",
							padding: "1.5rem",
							textAlign: "center",
						}}
					>
						<div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🟤</div>
						<div style={{ fontSize: "2rem", fontWeight: 700, color: "#c4a77d" }}>
							{(capsuleStats.originalCapsules ?? 0).toLocaleString()}
						</div>
						<div style={{ fontSize: "0.9rem", color: "#888", marginTop: "0.25rem" }}>Original Capsules</div>
					</div>

					{/* Vertuo Capsules */}
					<div
						style={{
							background: "rgba(139, 92, 246, 0.1)",
							border: "1px solid rgba(139, 92, 246, 0.3)",
							borderRadius: "12px",
							padding: "1.5rem",
							textAlign: "center",
						}}
					>
						<div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🟣</div>
						<div style={{ fontSize: "2rem", fontWeight: 700, color: "#8b5cf6" }}>
							{(capsuleStats.vertuoCapsules ?? 0).toLocaleString()}
						</div>
						<div style={{ fontSize: "0.9rem", color: "#888", marginTop: "0.25rem" }}>Vertuo Capsules</div>
					</div>
				</div>
			</div>

			{/* Consumption Analytics Card */}
			<div
				className="card"
				style={{
					marginBottom: "2rem",
					overflow: "hidden",
					background: "linear-gradient(145deg, #1a1a1a 0%, #0f0f0f 100%)",
					border: "1px solid rgba(255,255,255,0.05)",
					boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
				}}
			>
				{/* Header */}
				<div
					style={{
						padding: "2rem 2rem 1rem",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "end",
					}}
				>
					<div>
						<h2
							style={{
								margin: 0,
								display: "flex",
								alignItems: "center",
								gap: "0.75rem",
								fontSize: "1.25rem",
								fontWeight: 600,
							}}
						>
							<span style={{ fontSize: "1.5rem" }}>📊</span>
							<span>Consumption Analytics</span>
						</h2>
						<p style={{ margin: "0.5rem 0 0 0", color: "#888", fontSize: "0.9rem" }}>Breakdown by system type</p>
					</div>
					{/* Mini Legend */}
					<div style={{ display: "flex", gap: "1rem" }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "0.5rem",
								fontSize: "0.8rem",
								color: "#c4a77d",
							}}
						>
							<div
								style={{
									width: 8,
									height: 8,
									borderRadius: "50%",
									background: "#c4a77d",
									boxShadow: "0 0 8px #c4a77d",
								}}
							/>{" "}
							Original
						</div>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "0.5rem",
								fontSize: "0.8rem",
								color: "#8b5cf6",
							}}
						>
							<div
								style={{
									width: 8,
									height: 8,
									borderRadius: "50%",
									background: "#8b5cf6",
									boxShadow: "0 0 8px #8b5cf6",
								}}
							/>{" "}
							Vertuo
						</div>
					</div>
				</div>

				{/* Charts Container */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: "2rem",
						padding: "1rem 2rem 2rem",
						position: "relative",
					}}
				>
					{/* Capsules Chart */}
					<ConsumptionGraph
						data={consumptionHistory?.capsules || []}
						type="capsules"
						title="Capsules Consumption History"
						consumptionHistory={consumptionHistory}
						hoveredGraphPoint={hoveredGraphPoint}
						setHoveredGraphPoint={setHoveredGraphPoint}
						accountId={accountId}
						initialTheme={graphTheme}
					/>

					{/* Machines Chart */}
					<ConsumptionGraph
						data={consumptionHistory?.machines || []}
						type="machines"
						title="Machine Purchases History"
						consumptionHistory={consumptionHistory}
						hoveredGraphPoint={hoveredGraphPoint}
						setHoveredGraphPoint={setHoveredGraphPoint}
						accountId={accountId}
						initialTheme={graphTheme}
					/>
				</div>

				{/* Overall Preference Section */}
				<div
					style={{
						marginTop: "2rem",
						padding: "1.5rem",
						background: "linear-gradient(180deg, #1a1a1a 0%, #141414 100%)",
						borderRadius: "16px",
						border: "1px solid #2a2a2a",
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "1rem",
						}}
					>
						<div style={{ fontSize: "0.9rem", color: "#888", fontWeight: 500 }}>☕ Your Coffee System Preference</div>
						{(() => {
							const originalCapsules = capsuleStats.originalCapsules ?? 0;
							const vertuoCapsules = capsuleStats.vertuoCapsules ?? 0;
							const originalMachines = capsuleStats.machineStats?.original ?? 0;
							const vertuoMachines = capsuleStats.machineStats?.vertuo ?? 0;
							const totalOriginal = originalCapsules + originalMachines * 100;
							const totalVertuo = vertuoCapsules + vertuoMachines * 100;

							if (totalOriginal > totalVertuo * 1.2) {
								return (
									<div
										style={{
											background: "rgba(196, 167, 125, 0.15)",
											border: "1px solid rgba(196, 167, 125, 0.3)",
											padding: "0.35rem 0.75rem",
											borderRadius: "20px",
											fontSize: "0.75rem",
											fontWeight: 600,
											color: "#c4a77d",
											display: "flex",
											alignItems: "center",
											gap: "0.35rem",
										}}
									>
										<span>🟤</span> Original Lover
									</div>
								);
							} else if (totalVertuo > totalOriginal * 1.2) {
								return (
									<div
										style={{
											background: "rgba(139, 92, 246, 0.15)",
											border: "1px solid rgba(139, 92, 246, 0.3)",
											padding: "0.35rem 0.75rem",
											borderRadius: "20px",
											fontSize: "0.75rem",
											fontWeight: 600,
											color: "#8b5cf6",
											display: "flex",
											alignItems: "center",
											gap: "0.35rem",
										}}
									>
										<span>🟣</span> Vertuo Enthusiast
									</div>
								);
							} else {
								return (
									<div
										style={{
											background:
												"linear-gradient(90deg, rgba(196, 167, 125, 0.15), rgba(139, 92, 246, 0.15))",
											border: "1px solid rgba(255,255,255,0.1)",
											padding: "0.35rem 0.75rem",
											borderRadius: "20px",
											fontSize: "0.75rem",
											fontWeight: 600,
											color: "#e5e5e5",
											display: "flex",
											alignItems: "center",
											gap: "0.35rem",
										}}
									>
										<span>✨</span> Balanced Connoisseur
									</div>
								);
							}
						})()}
					</div>

					{/* Progress Bar and Stats */}
					{(() => {
						const originalCapsules = capsuleStats.originalCapsules ?? 0;
						const vertuoCapsules = capsuleStats.vertuoCapsules ?? 0;
						const originalMachines = capsuleStats.machineStats?.original ?? 0;
						const vertuoMachines = capsuleStats.machineStats?.vertuo ?? 0;
						const totalOriginal = originalCapsules + originalMachines * 100;
						const totalVertuo = vertuoCapsules + vertuoMachines * 100;
						const total = totalOriginal + totalVertuo;
						const originalPct = total > 0 ? (totalOriginal / total) * 100 : 50;
						const vertuoPct = total > 0 ? (totalVertuo / total) * 100 : 50;

						return (
							<>
								<div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
									<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: "100px" }}>
										<div
											style={{
												width: "32px",
												height: "32px",
												borderRadius: "50%",
												background: "linear-gradient(135deg, #c4a77d, #a67c52)",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontSize: "0.9rem",
												boxShadow: "0 0 12px rgba(196, 167, 125, 0.4)",
											}}
										>
											🟤
										</div>
										<span style={{ fontWeight: 700, color: "#c4a77d", fontSize: "1.1rem" }}>
											{originalPct.toFixed(0)}%
										</span>
									</div>

									<div
										style={{
											flex: 1,
											height: "32px",
											background: "#222",
											borderRadius: "16px",
											overflow: "hidden",
											display: "flex",
											position: "relative",
											boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
										}}
									>
										<div
											style={{
												width: `${originalPct}%`,
												height: "100%",
												background: "linear-gradient(90deg, #c4a77d, #a67c52)",
												transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
												boxShadow: "0 0 20px rgba(196, 167, 125, 0.3)",
												position: "relative",
											}}
										>
											<div
												style={{
													position: "absolute",
													top: 0,
													left: 0,
													right: 0,
													height: "50%",
													background:
														"linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 100%)",
													borderRadius: "16px 16px 0 0",
												}}
											/>
										</div>
										<div
											style={{
												width: `${vertuoPct}%`,
												height: "100%",
												background: "linear-gradient(90deg, #8b5cf6, #6d28d9)",
												transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
												boxShadow: "0 0 20px rgba(139, 92, 246, 0.3)",
												position: "relative",
											}}
										>
											<div
												style={{
													position: "absolute",
													top: 0,
													left: 0,
													right: 0,
													height: "50%",
													background:
														"linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 100%)",
													borderRadius: "16px 16px 0 0",
												}}
											/>
										</div>
										{total > 0 && (
											<div
												style={{
													position: "absolute",
													left: `${originalPct}%`,
													top: "50%",
													transform: "translate(-50%, -50%)",
													width: "4px",
													height: "40px",
													background: "#141414",
													borderRadius: "2px",
													zIndex: 2,
												}}
											/>
										)}
									</div>

									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "0.5rem",
											minWidth: "100px",
											justifyContent: "flex-end",
										}}
									>
										<span style={{ fontWeight: 700, color: "#8b5cf6", fontSize: "1.1rem" }}>
											{vertuoPct.toFixed(0)}%
										</span>
										<div
											style={{
												width: "32px",
												height: "32px",
												borderRadius: "50%",
												background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontSize: "0.9rem",
												boxShadow: "0 0 12px rgba(139, 92, 246, 0.4)",
											}}
										>
											🟣
										</div>
									</div>
								</div>

								{/* Quick Stats Row */}
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "1fr 1fr",
										gap: "1rem",
										marginTop: "1rem",
										paddingTop: "1rem",
										borderTop: "1px solid #2a2a2a",
									}}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											gap: "0.75rem",
											padding: "0.5rem",
											background: "rgba(196, 167, 125, 0.05)",
											borderRadius: "8px",
										}}
									>
										<span style={{ color: "#888", fontSize: "0.8rem" }}>Original:</span>
										<span style={{ color: "#c4a77d", fontWeight: 600 }}>
											{originalCapsules.toLocaleString()} capsules
										</span>
										<span style={{ color: "#555" }}>•</span>
										<span style={{ color: "#c4a77d", fontWeight: 600 }}>{originalMachines} machines</span>
									</div>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											gap: "0.75rem",
											padding: "0.5rem",
											background: "rgba(139, 92, 246, 0.05)",
											borderRadius: "8px",
										}}
									>
										<span style={{ color: "#888", fontSize: "0.8rem" }}>Vertuo:</span>
										<span style={{ color: "#8b5cf6", fontWeight: 600 }}>
											{vertuoCapsules.toLocaleString()} capsules
										</span>
										<span style={{ color: "#555" }}>•</span>
										<span style={{ color: "#8b5cf6", fontWeight: 600 }}>{vertuoMachines} machines</span>
									</div>
								</div>
							</>
						);
					})()}
				</div>
			</div>

			{/* Yearly History */}
			{capsuleStats.yearlyHistory.length > 0 && (
				<div className="card">
					<h2 style={{ marginBottom: "1.5rem" }}>📜 Yearly Tier History</h2>
					<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
						{capsuleStats.yearlyHistory.map((yearData) => {
							const tierColors = TIER_COLORS[yearData.tier];
							const isCurrentYear = yearData.year === new Date().getFullYear();

							return (
								<div
									key={yearData.year}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										padding: "1rem 1.25rem",
										background: isCurrentYear ? tierColors?.bg || "#1a1a1a" : "#1a1a1a",
										border: `1px solid ${isCurrentYear ? tierColors?.primary + "40" : "#333"}`,
										borderRadius: "10px",
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
										<div
											style={{
												width: "48px",
												height: "48px",
												borderRadius: "12px",
												background: tierColors?.bg || "rgba(136, 136, 136, 0.15)",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontSize: "1.5rem",
											}}
										>
											{TIER_BENEFITS[yearData.tier]?.icon || "🌱"}
										</div>
										<div>
											<div style={{ fontWeight: 600, color: "#e5e5e5", fontSize: "1.1rem" }}>
												{yearData.year}
												{isCurrentYear && (
													<span
														style={{
															marginLeft: "0.5rem",
															fontSize: "0.7rem",
															background: tierColors?.primary + "30",
															color: tierColors?.primary,
															padding: "2px 8px",
															borderRadius: "4px",
															fontWeight: 600,
														}}
													>
														CURRENT
													</span>
												)}
											</div>
											<div style={{ fontSize: "0.85rem", color: "#888", marginTop: "0.25rem" }}>
												{yearData.capsules.toLocaleString()} capsules • {yearData.orders} order
												{yearData.orders !== 1 ? "s" : ""}
												{(yearData.originalCapsules > 0 || yearData.vertuoCapsules > 0) && (
													<span style={{ marginLeft: "0.5rem", color: "#666" }}>
														(🟤 {(yearData.originalCapsules ?? 0).toLocaleString()} • 🟣{" "}
														{(yearData.vertuoCapsules ?? 0).toLocaleString()})
													</span>
												)}
											</div>
										</div>
									</div>
									<div
										style={{
											background: `linear-gradient(135deg, ${tierColors?.primary || "#888"}, ${
												tierColors?.secondary || "#666"
											})`,
											color: "#fff",
											padding: "6px 14px",
											borderRadius: "8px",
											fontSize: "0.85rem",
											fontWeight: 600,
										}}
									>
										{yearData.tier}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
