"use client";

import Image from "next/image";
import { Repair, formatDate, gradientTextStyle, getCardTypeImage } from "./types";

type RepairsHistoryProps = {
	repairs: Repair[];
	page?: number;
	totalPages?: number;
	onPageChange?: (page: number) => void;
};

export function RepairsHistory({ repairs, page = 1, totalPages = 1, onPageChange }: RepairsHistoryProps) {
	const getRepairStatusColor = (status: string) => {
		const colors: Record<string, string> = {
			pending: "#f59e0b",
			received: "#3b82f6",
			diagnosing: "#8b5cf6",
			repairing: "#06b6d4",
			testing: "#a855f7",
			ready: "#22c55e",
			completed: "#10b981",
			cancelled: "#ef4444",
		};
		return colors[status] || "#6b7280";
	};

	const getRepairStatusIcon = (status: string) => {
		const icons: Record<string, string> = {
			pending: "⏳",
			received: "📦",
			diagnosing: "🔍",
			repairing: "🔧",
			testing: "🧪",
			ready: "✅",
			completed: "🎉",
			cancelled: "❌",
		};
		return icons[status] || "🔧";
	};

	const getRepairTypeLabel = (type: string) => {
		const labels: Record<string, string> = {
			cleaning: "Deep Cleaning",
			descaling: "Descaling",
			pump: "Pump Repair",
			heating: "Heating Element",
			general: "General Maintenance",
		};
		return labels[type] || type;
	};

	const renderPager = () => {
		if (!onPageChange || totalPages <= 1) return null;
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "flex-end",
					alignItems: "center",
					gap: "0.65rem",
					marginTop: "0.75rem",
					padding: "0.35rem 0.5rem",
					borderRadius: 12,
					background: "linear-gradient(135deg, rgba(196,167,125,0.08), rgba(166,124,82,0.12))",
					border: "1px solid #2d2d2d",
					boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
					backdropFilter: "blur(6px)",
				}}
			>
				<button
					onClick={() => onPageChange(Math.max(1, page - 1))}
					disabled={page === 1}
					style={{
						padding: "8px 12px",
						borderRadius: 10,
						border: "1px solid #3a3a3a",
						background: page === 1 ? "#1a1a1a" : "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)",
						color: page === 1 ? "#666" : "#0f0f0f",
						cursor: page === 1 ? "not-allowed" : "pointer",
						fontWeight: 700,
						transition: "transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease",
						boxShadow: page === 1 ? "none" : "0 8px 16px rgba(166,124,82,0.35)",
						filter: page === 1 ? "grayscale(0.6)" : "none",
					}}
					onMouseEnter={(e) => {
						if (page === 1) return;
						e.currentTarget.style.transform = "translateY(-2px)";
						e.currentTarget.style.boxShadow = "0 12px 20px rgba(166,124,82,0.45)";
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.transform = "translateY(0)";
						e.currentTarget.style.boxShadow = page === 1 ? "none" : "0 8px 16px rgba(166,124,82,0.35)";
					}}
				>
					◀
				</button>
				<span style={{ alignSelf: "center", color: "#aaa", fontSize: "0.9rem" }}>
					Page {page} of {totalPages}
				</span>
				<button
					onClick={() => onPageChange(Math.min(totalPages, page + 1))}
					disabled={page === totalPages}
					style={{
						padding: "8px 12px",
						borderRadius: 10,
						border: "1px solid #3a3a3a",
						background: page === totalPages ? "#1a1a1a" : "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)",
						color: page === totalPages ? "#666" : "#0f0f0f",
						cursor: page === totalPages ? "not-allowed" : "pointer",
						fontWeight: 700,
						transition: "transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease",
						boxShadow: page === totalPages ? "none" : "0 8px 16px rgba(166,124,82,0.35)",
						filter: page === totalPages ? "grayscale(0.6)" : "none",
					}}
					onMouseEnter={(e) => {
						if (page === totalPages) return;
						e.currentTarget.style.transform = "translateY(-2px)";
						e.currentTarget.style.boxShadow = "0 12px 20px rgba(166,124,82,0.45)";
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.transform = "translateY(0)";
						e.currentTarget.style.boxShadow = page === totalPages ? "none" : "0 8px 16px rgba(166,124,82,0.35)";
					}}
				>
					▶
				</button>
			</div>
		);
	};

	return (
		<div className="card" style={{ marginBottom: "2rem" }}>
			<h2>🔧 Repairs History</h2>
			{repairs.length === 0 ? (
				<p className="empty-state">No repair requests found. Submit a repair request from the Machines tab.</p>
			) : (
				<div
					key={`repairs-page-${page}`}
					className="repairs-list"
					style={{ display: "flex", flexDirection: "column", gap: "1rem", animation: "pager-fade-slide 0.35s ease" }}
				>
					{repairs.map((repair) => {
						const cost = Number(repair.estimated_cost) || 0;
						const pickupDate = repair.pickup_date ? new Date(repair.pickup_date) : null;

						return (
							<div
								key={repair.id}
								className="repair-item"
								style={{
									border: "1px solid #333",
									borderRadius: "12px",
									overflow: "hidden",
									background: "#121212",
									boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										padding: "1.5rem",
										background: "#121212",
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
										{/* Status Icon/Badge */}
										<div
											style={{
												width: "48px",
												height: "48px",
												borderRadius: "12px",
												background: getRepairStatusColor(repair.status) + "15",
												color: getRepairStatusColor(repair.status),
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontSize: "1.5rem",
											}}
										>
											{getRepairStatusIcon(repair.status)}
										</div>

										<div>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "0.75rem",
													flexWrap: "wrap",
												}}
											>
												<span
													style={{
														fontWeight: 700,
														fontSize: "1.1rem",
														...gradientTextStyle,
													}}
												>
													{repair.machine_name}
												</span>
												<span
													style={{
														background: getRepairStatusColor(repair.status) + "15",
														color: getRepairStatusColor(repair.status),
														padding: "4px 10px",
														borderRadius: "6px",
														fontSize: "0.75rem",
														fontWeight: 700,
														textTransform: "uppercase",
														letterSpacing: "0.5px",
													}}
												>
													{repair.status}
												</span>
												{repair.is_warranty ? (
													<span
														style={{
															background: "rgba(16, 185, 129, 0.15)",
															color: "#10b981",
															padding: "4px 10px",
															borderRadius: "6px",
															fontSize: "0.75rem",
															fontWeight: 700,
															letterSpacing: "0.5px",
														}}
													>
														🛡️ WARRANTY
													</span>
												) : (
													<span
														style={{
															background: "rgba(196, 167, 125, 0.15)",
															color: "#c4a77d",
															padding: "4px 10px",
															borderRadius: "6px",
															fontSize: "0.75rem",
															fontWeight: 700,
															letterSpacing: "0.5px",
														}}
													>
														💳 PAID
													</span>
												)}
											</div>
											<div
												style={{
													fontSize: "0.9rem",
													color: "#aaa",
													marginTop: "0.35rem",
													display: "flex",
													alignItems: "center",
													gap: "0.5rem",
													flexWrap: "wrap",
												}}
											>
												<span style={{ color: "#e5e5e5" }}>📅 {formatDate(repair.created_at)}</span>
												<span>•</span>
												<span style={{ color: "#c4a77d" }}>
													🔧 {getRepairTypeLabel(repair.repair_type)}
												</span>
												{repair.weather_delay ? (
													<>
														<span>•</span>
														<span style={{ color: "#6BB3F8" }}>🌧️ Weather delay</span>
													</>
												) : null}
												{repair.warranty_delay ? (
													<>
														<span>•</span>
														<span style={{ color: "#10b981" }}>🛡️ Warranty processing</span>
													</>
												) : null}
											</div>
											{/* Charged to - between date/type row and order number */}
											{!repair.is_warranty && repair.card_type && repair.card_last_four && (
												<div
													style={{
														display: "flex",
														alignItems: "center",
														gap: "0.5rem",
														marginTop: "0.35rem",
													}}
												>
													<Image
														src={getCardTypeImage(repair.card_type)}
														alt={repair.card_type}
														width={28}
														height={18}
														style={{ borderRadius: "3px" }}
													/>
													<span style={{ fontSize: "0.85rem", color: "#888" }}>
														Charged to{" "}
														<span
															style={{
																color: "#c4a77d",
																fontWeight: 500,
																fontFamily: "'Courier New', monospace",
															}}
														>
															•••• {repair.card_last_four}
														</span>
													</span>
												</div>
											)}
											{repair.order_number && (
												<div style={{ fontSize: "0.85rem", color: "#888", marginTop: "0.25rem" }}>
													Order #{repair.order_number.split("-")[1] || repair.order_number}
												</div>
											)}
										</div>
									</div>

									<div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
										<div style={{ textAlign: "right" }}>
											{repair.is_warranty ? (
												<>
													<div style={{ fontSize: "0.85rem", color: "#aaa", marginBottom: "2px" }}>
														Covered by Warranty
													</div>
													<div
														style={{
															fontWeight: 700,
															fontSize: "1.25rem",
															color: "#10b981",
														}}
													>
														FREE
													</div>
												</>
											) : (
												<>
													<div style={{ fontSize: "0.85rem", color: "#aaa", marginBottom: "2px" }}>
														Service Cost
													</div>
													<div
														style={{
															fontWeight: 700,
															fontSize: "1.25rem",
															...gradientTextStyle,
														}}
													>
														{cost.toFixed(2)}{" "}
														<span style={{ fontSize: "0.9rem", fontWeight: 500 }}>RON</span>
													</div>
												</>
											)}
											{pickupDate && repair.status !== "completed" && repair.status !== "cancelled" && (
												<div style={{ fontSize: "0.8rem", color: "#888", marginTop: "4px" }}>
													Est. ready: {formatDate(pickupDate.toISOString())}
												</div>
											)}
											{repair.completion_date && repair.status === "completed" && (
												<div style={{ fontSize: "0.8rem", color: "#10b981", marginTop: "4px" }}>
													✓ Completed: {formatDate(repair.completion_date)}
												</div>
											)}
										</div>
									</div>
								</div>

								{/* Progress bar for active repairs */}
								{repair.status !== "completed" && repair.status !== "cancelled" && (
									<div
										style={{
											padding: "0.75rem 1.5rem 1rem",
											background: "#1a1a1a",
											borderTop: "1px solid #333",
										}}
									>
										<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
											{["pending", "received", "diagnosing", "repairing", "testing", "ready"].map(
												(step, idx) => {
													const steps = [
														"pending",
														"received",
														"diagnosing",
														"repairing",
														"testing",
														"ready",
													];
													const currentIdx = steps.indexOf(repair.status);
													const isActive = idx <= currentIdx;
													const isCurrent = idx === currentIdx;

													return (
														<div
															key={step}
															style={{
																display: "flex",
																flexDirection: "column",
																alignItems: "center",
																flex: 1,
																opacity: isActive ? 1 : 0.4,
															}}
														>
															<div
																style={{
																	width: "24px",
																	height: "24px",
																	borderRadius: "50%",
																	background: isActive
																		? isCurrent
																			? getRepairStatusColor(step)
																			: "#10b981"
																		: "#333",
																	display: "flex",
																	alignItems: "center",
																	justifyContent: "center",
																	fontSize: "0.7rem",
																	color: isActive ? "#fff" : "#666",
																	fontWeight: 700,
																	boxShadow: isCurrent
																		? `0 0 8px ${getRepairStatusColor(step)}`
																		: "none",
																}}
															>
																{isActive && idx < currentIdx ? "✓" : idx + 1}
															</div>
															<span
																style={{
																	fontSize: "0.65rem",
																	color: isActive ? "#aaa" : "#555",
																	marginTop: "4px",
																	textTransform: "capitalize",
																}}
															>
																{step}
															</span>
														</div>
													);
												}
											)}
										</div>
										<div
											style={{
												height: "4px",
												background: "#333",
												borderRadius: "2px",
												marginTop: "0.5rem",
												overflow: "hidden",
											}}
										>
											<div
												style={{
													height: "100%",
													background: "linear-gradient(90deg, #10b981 0%, #c4a77d 100%)",
													borderRadius: "2px",
													width: `${
														(([
															"pending",
															"received",
															"diagnosing",
															"repairing",
															"testing",
															"ready",
														].indexOf(repair.status) +
															1) /
															6) *
														100
													}%`,
													transition: "width 0.3s ease",
												}}
											/>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{renderPager()}
		</div>
	);
}
