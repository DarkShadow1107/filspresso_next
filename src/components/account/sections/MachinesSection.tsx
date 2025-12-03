"use client";

import Image from "next/image";
import { UserMachine, RepairType, formatDate, gradientTextStyle } from "./types";

type MachinesSectionProps = {
	userMachines: UserMachine[];
	isLoadingMachines: boolean;
	setMaintenancePopup: (popup: { open: boolean; machine: UserMachine | null }) => void;
	setRepairPopup: (popup: { open: boolean; machine: UserMachine | null }) => void;
	setSelectedRepairType: (type: RepairType) => void;
	getProductImage: (productId: string) => string | undefined;
};

export function MachinesSection({
	userMachines,
	isLoadingMachines,
	setMaintenancePopup,
	setRepairPopup,
	setSelectedRepairType,
	getProductImage,
}: MachinesSectionProps) {
	return (
		<div className="tab-pane fade-in">
			<div className="card">
				<div
					className="card-header"
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: "1.5rem",
					}}
				>
					<h2 style={{ margin: 0 }}>☕ My Machines & Forfaits</h2>
					<div style={{ fontSize: "0.9rem", color: "#888" }}>
						{userMachines.length} item{userMachines.length !== 1 ? "s" : ""} registered
					</div>
				</div>

				{isLoadingMachines ? (
					<div style={{ textAlign: "center", padding: "3rem", color: "#888" }}>
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
						Loading your machines...
					</div>
				) : userMachines.length === 0 ? (
					<div style={{ textAlign: "center", padding: "2.5rem" }}>
						<div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>☕</div>
						<p style={{ color: "#888", fontSize: "1rem", margin: "0 0 0.5rem 0" }}>No machines found</p>
						<p style={{ color: "#666", fontSize: "0.85rem", margin: 0 }}>
							Purchase a Nespresso machine to see it here
						</p>
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
						{userMachines.map((machine) => {
							const warrantyEndDate = new Date(machine.warranty_end_date);
							const daysUntilWarrantyEnd = Math.ceil(
								(warrantyEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
							);
							const machineImage = machine.product_image || getProductImage(machine.product_id);

							return (
								<div
									key={machine.id}
									style={{
										background: "#1a1a1a",
										border: "1px solid #333",
										borderRadius: "12px",
										overflow: "hidden",
										transition: "all 0.2s ease",
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.borderColor = "rgba(196, 167, 125, 0.4)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.borderColor = "#333";
									}}
								>
									{/* Machine Header */}
									<div style={{ display: "flex", padding: "1rem", gap: "1rem" }}>
										{/* Machine Image */}
										<div
											style={{
												width: "90px",
												height: "90px",
												borderRadius: "10px",
												background: "#121212",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												overflow: "hidden",
												border: "1px solid #333",
												flexShrink: 0,
											}}
										>
											{machineImage ? (
												<Image
													src={machineImage}
													alt={machine.product_name}
													width={80}
													height={80}
													style={{ objectFit: "contain" }}
												/>
											) : (
												<span style={{ fontSize: "2.5rem" }}>☕</span>
											)}
										</div>

										{/* Machine Info */}
										<div style={{ flex: 1, minWidth: 0 }}>
											<div
												style={{
													display: "flex",
													justifyContent: "space-between",
													alignItems: "flex-start",
													gap: "0.5rem",
												}}
											>
												<div style={{ flex: 1, minWidth: 0 }}>
													<div
														style={{
															display: "flex",
															alignItems: "center",
															gap: "0.5rem",
															flexWrap: "wrap",
														}}
													>
														<h3
															style={{
																margin: 0,
																fontSize: "1.1rem",
																...gradientTextStyle,
																whiteSpace: "nowrap",
																overflow: "hidden",
																textOverflow: "ellipsis",
															}}
														>
															{machine.product_name}
														</h3>
														{machine.is_forfait ? (
															<span
																style={{
																	background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
																	color: "#fff",
																	padding: "2px 6px",
																	borderRadius: "4px",
																	fontSize: "0.65rem",
																	fontWeight: 600,
																	textTransform: "uppercase",
																	letterSpacing: "0.5px",
																}}
															>
																Forfait
															</span>
														) : null}
													</div>
													<div style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem" }}>
														Order #{machine.order_number}
													</div>
												</div>
												<div
													style={{
														background: machine.is_under_warranty
															? "rgba(16, 185, 129, 0.15)"
															: "rgba(245, 158, 11, 0.15)",
														color: machine.is_under_warranty ? "#10b981" : "#f59e0b",
														padding: "4px 8px",
														borderRadius: "6px",
														fontSize: "0.7rem",
														fontWeight: 600,
														whiteSpace: "nowrap",
													}}
												>
													{machine.is_under_warranty ? `✓ ${daysUntilWarrantyEnd}d left` : "Expired"}
												</div>
											</div>

											{/* Purchase Details - Compact inline */}
											<div
												style={{
													display: "flex",
													gap: "1rem",
													marginTop: "0.5rem",
													flexWrap: "wrap",
												}}
											>
												<div style={{ fontSize: "0.75rem" }}>
													<span style={{ color: "#666" }}>Bought: </span>
													<span style={{ color: "#ccc" }}>{formatDate(machine.purchase_date)}</span>
												</div>
												<div style={{ fontSize: "0.75rem" }}>
													<span style={{ color: "#666" }}>Price: </span>
													<span style={{ ...gradientTextStyle, fontWeight: 600 }}>
														{Number(machine.unit_price).toFixed(2)} RON
													</span>
												</div>
												<div style={{ fontSize: "0.75rem" }}>
													<span style={{ color: "#666" }}>Valid: </span>
													<span style={{ color: machine.is_under_warranty ? "#10b981" : "#f59e0b" }}>
														{formatDate(machine.warranty_end_date)}
													</span>
												</div>
											</div>
										</div>
									</div>

									{/* Action Buttons */}
									<div
										style={{
											display: "flex",
											gap: "0.5rem",
											padding: "0.75rem 1rem",
											background: "#121212",
											borderTop: "1px solid #333",
										}}
									>
										<button
											onClick={() => setMaintenancePopup({ open: true, machine })}
											style={{
												flex: 1,
												padding: "0.5rem 0.75rem",
												background:
													"linear-gradient(135deg, rgba(196, 167, 125, 0.15) 0%, rgba(166, 124, 82, 0.15) 100%)",
												border: "1px solid rgba(196, 167, 125, 0.4)",
												borderRadius: "8px",
												color: "#c4a77d",
												fontWeight: 600,
												cursor: "pointer",
												transition: "all 0.2s ease",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												gap: "0.4rem",
												fontSize: "0.8rem",
											}}
											onMouseEnter={(e) => {
												e.currentTarget.style.background =
													"linear-gradient(135deg, rgba(196, 167, 125, 0.25) 0%, rgba(166, 124, 82, 0.25) 100%)";
											}}
											onMouseLeave={(e) => {
												e.currentTarget.style.background =
													"linear-gradient(135deg, rgba(196, 167, 125, 0.15) 0%, rgba(166, 124, 82, 0.15) 100%)";
											}}
										>
											🔧 Maintenance
										</button>
										<button
											onClick={() => {
												setSelectedRepairType("general");
												setRepairPopup({ open: true, machine });
											}}
											style={{
												flex: 1,
												padding: "0.5rem 0.75rem",
												background: machine.is_under_warranty
													? "linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.15) 100%)"
													: "linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(37, 99, 235, 0.15) 100%)",
												border: machine.is_under_warranty
													? "1px solid rgba(16, 185, 129, 0.4)"
													: "1px solid rgba(59, 130, 246, 0.4)",
												borderRadius: "8px",
												color: machine.is_under_warranty ? "#10b981" : "#60a5fa",
												fontWeight: 600,
												cursor: "pointer",
												transition: "all 0.2s ease",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												gap: "0.4rem",
												fontSize: "0.8rem",
											}}
											onMouseEnter={(e) => {
												e.currentTarget.style.opacity = "0.85";
											}}
											onMouseLeave={(e) => {
												e.currentTarget.style.opacity = "1";
											}}
										>
											{machine.is_under_warranty ? "🛡️ Warranty" : "🔩 Repair"}
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
