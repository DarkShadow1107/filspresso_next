"use client";

import { createPortal } from "react-dom";
import { UserMachine } from "./types";

interface MaintenancePopupProps {
	isOpen: boolean;
	machine: UserMachine | null;
	onClose: () => void;
}

export default function MaintenancePopup({ isOpen, machine, onClose }: MaintenancePopupProps) {
	// Don't render if not open or no machine
	if (!isOpen || !machine) return null;

	return createPortal(
		<div
			style={{
				position: "fixed",
				inset: 0,
				backgroundColor: "rgba(0,0,0,0.9)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				zIndex: 99999,
				padding: "1rem",
				backdropFilter: "blur(4px)",
			}}
			onClick={onClose}
		>
			<div
				style={{
					backgroundColor: "#1a1a1a",
					borderRadius: "16px",
					maxWidth: "500px",
					width: "calc(100% - 2rem)",
					maxHeight: "min(600px, calc(100vh - 2rem))",
					overflowY: "auto",
					border: "1px solid rgba(196, 167, 125, 0.3)",
					boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(196, 167, 125, 0.1)",
					animation: "fadeInScale 0.2s ease-out",
				}}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div
					style={{
						padding: "1rem 1.25rem",
						borderBottom: "1px solid rgba(196, 167, 125, 0.2)",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						position: "sticky",
						top: 0,
						backgroundColor: "#1a1a1a",
						zIndex: 1,
					}}
				>
					<div>
						<h3 style={{ margin: 0, color: "#c4a77d", fontSize: "1.1rem" }}>Maintenance Guide</h3>
						<p style={{ margin: "0.25rem 0 0", color: "#888", fontSize: "0.8rem" }}>{machine.product_name}</p>
					</div>
					<button
						onClick={onClose}
						style={{
							background: "none",
							border: "none",
							color: "#888",
							fontSize: "1.5rem",
							cursor: "pointer",
							padding: "0.25rem",
							lineHeight: 1,
						}}
					>
						×
					</button>
				</div>

				{/* Content */}
				<div style={{ padding: "1rem 1.25rem" }}>
					{/* General Care Tips */}
					<div style={{ marginBottom: "1.25rem" }}>
						<h4 style={{ color: "#c4a77d", marginBottom: "0.75rem", fontSize: "0.9rem" }}>☕ Care Tips</h4>
						<ul
							style={{
								listStyle: "none",
								padding: 0,
								margin: 0,
								display: "flex",
								flexDirection: "column",
								gap: "0.5rem",
							}}
						>
							<li
								style={{
									padding: "0.5rem 0.75rem",
									backgroundColor: "rgba(196, 167, 125, 0.1)",
									borderRadius: "6px",
									color: "#ccc",
									fontSize: "0.8rem",
								}}
							>
								✓ Empty the drip tray and capsule container daily
							</li>
							<li
								style={{
									padding: "0.5rem 0.75rem",
									backgroundColor: "rgba(196, 167, 125, 0.1)",
									borderRadius: "6px",
									color: "#ccc",
									fontSize: "0.8rem",
								}}
							>
								✓ Clean the water tank weekly with fresh water
							</li>
							<li
								style={{
									padding: "0.5rem 0.75rem",
									backgroundColor: "rgba(196, 167, 125, 0.1)",
									borderRadius: "6px",
									color: "#ccc",
									fontSize: "0.8rem",
								}}
							>
								✓ Wipe the machine exterior with a damp cloth
							</li>
							<li
								style={{
									padding: "0.5rem 0.75rem",
									backgroundColor: "rgba(196, 167, 125, 0.1)",
									borderRadius: "6px",
									color: "#ccc",
									fontSize: "0.8rem",
								}}
							>
								✓ Store in a dry place away from direct sunlight
							</li>
						</ul>
					</div>

					{/* Scheduled Maintenance */}
					<div style={{ marginBottom: "1.25rem" }}>
						<h4 style={{ color: "#c4a77d", marginBottom: "0.75rem", fontSize: "0.9rem" }}>📅 Scheduled Tasks</h4>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: "0.5rem",
							}}
						>
							{/* Descaling */}
							<div
								style={{
									padding: "0.75rem",
									backgroundColor: "rgba(255, 193, 7, 0.1)",
									borderRadius: "8px",
									border: "1px solid rgba(255, 193, 7, 0.3)",
								}}
							>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: "0.25rem",
									}}
								>
									<span style={{ color: "#ffc107", fontWeight: 600, fontSize: "0.8rem" }}>🧴 Descaling</span>
								</div>
								<span
									style={{
										fontSize: "0.7rem",
										color: "#888",
									}}
								>
									Every 3 months
								</span>
							</div>

							{/* Deep Cleaning */}
							<div
								style={{
									padding: "0.75rem",
									backgroundColor: "rgba(33, 150, 243, 0.1)",
									borderRadius: "8px",
									border: "1px solid rgba(33, 150, 243, 0.3)",
								}}
							>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: "0.25rem",
									}}
								>
									<span style={{ color: "#2196f3", fontWeight: 600, fontSize: "0.8rem" }}>🧹 Deep Clean</span>
								</div>
								<span
									style={{
										fontSize: "0.7rem",
										color: "#888",
									}}
								>
									Monthly
								</span>
							</div>

							{/* Water Filter */}
							<div
								style={{
									padding: "0.75rem",
									backgroundColor: "rgba(76, 175, 80, 0.1)",
									borderRadius: "8px",
									border: "1px solid rgba(76, 175, 80, 0.3)",
								}}
							>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: "0.25rem",
									}}
								>
									<span style={{ color: "#4caf50", fontWeight: 600, fontSize: "0.8rem" }}>
										💧 Filter Change
									</span>
								</div>
								<span
									style={{
										fontSize: "0.7rem",
										color: "#888",
									}}
								>
									Every 2 months
								</span>
							</div>
						</div>
					</div>

					{/* Warranty Info */}
					<div
						style={{
							padding: "0.75rem",
							backgroundColor: machine.is_under_warranty ? "rgba(76, 175, 80, 0.1)" : "rgba(244, 67, 54, 0.1)",
							borderRadius: "8px",
							border: `1px solid ${
								machine.is_under_warranty ? "rgba(76, 175, 80, 0.3)" : "rgba(244, 67, 54, 0.3)"
							}`,
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "0.5rem",
							}}
						>
							<span style={{ fontSize: "1.2rem" }}>{machine.is_under_warranty ? "🛡️" : "⚠️"}</span>
							<div>
								<div
									style={{
										fontWeight: 600,
										fontSize: "0.85rem",
										color: machine.is_under_warranty ? "#4caf50" : "#f44336",
									}}
								>
									Warranty {machine.is_under_warranty ? "Active" : "Expired"}
								</div>
								<div style={{ fontSize: "0.7rem", color: "#888" }}>
									{machine.is_under_warranty
										? `Covered until ${new Date(machine.warranty_end_date).toLocaleDateString()}`
										: "Consider our paid repair service"}
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Footer */}
				<div
					style={{
						padding: "1rem 1.25rem",
						borderTop: "1px solid rgba(196, 167, 125, 0.2)",
						display: "flex",
						justifyContent: "flex-end",
						position: "sticky",
						bottom: 0,
						backgroundColor: "#1a1a1a",
					}}
				>
					<button
						onClick={onClose}
						style={{
							padding: "0.6rem 1.25rem",
							backgroundColor: "#c4a77d",
							color: "#000",
							border: "none",
							borderRadius: "8px",
							cursor: "pointer",
							fontWeight: 600,
							fontSize: "0.85rem",
						}}
					>
						Close
					</button>
				</div>
			</div>
		</div>,
		document.body
	);
}
