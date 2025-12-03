"use client";

import { createPortal } from "react-dom";
import Image from "next/image";
import { UserMachine, SavedCard, RepairType, REPAIR_COSTS, getCardTypeImage, calculateRepairCost } from "./types";

interface RepairPopupProps {
	isOpen: boolean;
	machine: UserMachine | null;
	selectedRepairType: RepairType;
	selectedRepairPaymentId: number | null;
	useWarrantyForRepair: boolean;
	savedCards: SavedCard[];
	onClose: () => void;
	onSelectRepairType: (type: RepairType) => void;
	onSelectPaymentId: (id: number | null) => void;
	onToggleWarranty: (useWarranty: boolean) => void;
	onSubmit: () => void;
	notify: (message: string, duration?: number, variant?: "info" | "success" | "error", category?: string) => void;
}

export default function RepairPopup({
	isOpen,
	machine,
	selectedRepairType,
	selectedRepairPaymentId,
	useWarrantyForRepair,
	savedCards,
	onClose,
	onSelectRepairType,
	onSelectPaymentId,
	onToggleWarranty,
	onSubmit,
	notify,
}: RepairPopupProps) {
	// Don't render if not open or no machine
	if (!isOpen || !machine) return null;

	const handleClose = () => {
		onClose();
		onSelectRepairType("general");
		onSelectPaymentId(null);
		onToggleWarranty(true);
	};

	const handleSubmit = () => {
		const needsPayment = !machine.is_under_warranty || !useWarrantyForRepair;
		if (needsPayment && !selectedRepairPaymentId && savedCards.length > 0) {
			notify("Please select a payment method.", 3000, "info", "account");
			return;
		}
		onSubmit();
	};

	const needsPayment = !machine.is_under_warranty || !useWarrantyForRepair;
	const submitDisabled = needsPayment && savedCards.length === 0;

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
			onClick={handleClose}
		>
			<div
				style={{
					backgroundColor: "#1a1a1a",
					borderRadius: "16px",
					maxWidth: "480px",
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
						padding: "1.25rem 1.5rem",
						borderBottom: "1px solid rgba(196, 167, 125, 0.2)",
						position: "sticky",
						top: 0,
						backgroundColor: "#1a1a1a",
						zIndex: 1,
					}}
				>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<div>
							<h3 style={{ margin: 0, color: "#c4a77d", fontSize: "1.25rem", fontWeight: 600 }}>Request Repair</h3>
							<p style={{ margin: "0.35rem 0 0", color: "#aaa", fontSize: "0.9rem" }}>{machine.product_name}</p>
						</div>
						<button
							onClick={handleClose}
							style={{
								background: "transparent",
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
				</div>

				{/* Warranty/Payment Choice - Only show if under warranty */}
				{machine.is_under_warranty ? (
					<div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid rgba(196, 167, 125, 0.2)" }}>
						<div style={{ display: "flex", gap: "0.75rem" }}>
							{/* Use Warranty Option */}
							<div
								onClick={() => onToggleWarranty(true)}
								style={{
									flex: 1,
									padding: "0.85rem 1rem",
									backgroundColor: useWarrantyForRepair
										? "rgba(16, 185, 129, 0.1)"
										: "rgba(196, 167, 125, 0.05)",
									borderRadius: "12px",
									border: `2px solid ${useWarrantyForRepair ? "#10b981" : "rgba(196, 167, 125, 0.2)"}`,
									cursor: "pointer",
									transition: "all 0.2s ease",
								}}
							>
								<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
									<div
										style={{
											fontWeight: 600,
											color: useWarrantyForRepair ? "#10b981" : "#aaa",
											fontSize: "0.9rem",
											whiteSpace: "nowrap",
										}}
									>
										🆓 Use Warranty · <span style={{ fontWeight: 400, color: "#888" }}>Free</span>
									</div>
									{useWarrantyForRepair && (
										<span style={{ color: "#10b981", fontSize: "1rem", marginLeft: "0.5rem" }}>✓</span>
									)}
								</div>
							</div>
							{/* Pay Option */}
							<div
								onClick={() => onToggleWarranty(false)}
								style={{
									flex: 1,
									padding: "0.85rem 1rem",
									backgroundColor: !useWarrantyForRepair
										? "rgba(196, 167, 125, 0.1)"
										: "rgba(196, 167, 125, 0.05)",
									borderRadius: "12px",
									border: `2px solid ${!useWarrantyForRepair ? "#c4a77d" : "rgba(196, 167, 125, 0.2)"}`,
									cursor: "pointer",
									transition: "all 0.2s ease",
								}}
							>
								<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
									<div
										style={{
											fontWeight: 600,
											color: !useWarrantyForRepair ? "#c4a77d" : "#aaa",
											fontSize: "0.9rem",
											whiteSpace: "nowrap",
										}}
									>
										💳 Pay · <span style={{ fontWeight: 400, color: "#888" }}>Priority</span>
									</div>
									{!useWarrantyForRepair && (
										<span style={{ color: "#c4a77d", fontSize: "1rem", marginLeft: "0.5rem" }}>✓</span>
									)}
								</div>
							</div>
						</div>
						<div style={{ fontSize: "0.85rem", color: "#888", marginTop: "0.75rem", textAlign: "center" }}>
							Warranty valid until{" "}
							<span style={{ color: "#c4a77d", fontWeight: 500 }}>
								{new Date(machine.warranty_end_date).toLocaleDateString()}
							</span>
						</div>
					</div>
				) : null}

				{/* Repair Type Selection */}
				<div style={{ padding: "1.25rem 1.5rem" }}>
					<h4
						style={{
							margin: "0 0 1rem",
							color: "#aaa",
							fontSize: "0.85rem",
							fontWeight: 500,
							textTransform: "uppercase",
							letterSpacing: "0.5px",
						}}
					>
						Select Repair Type
					</h4>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
						{(["general", "cleaning", "descaling", "pump", "heating"] as RepairType[]).map((type, idx) => (
							<div
								key={type}
								style={{
									padding: "0.75rem 1rem",
									backgroundColor:
										selectedRepairType === type ? "rgba(196, 167, 125, 0.1)" : "rgba(196, 167, 125, 0.05)",
									borderRadius: "10px",
									border: `2px solid ${selectedRepairType === type ? "#c4a77d" : "rgba(196, 167, 125, 0.2)"}`,
									cursor: "pointer",
									transition: "all 0.2s ease",
									gridColumn: idx === 0 ? "1 / -1" : undefined,
								}}
								onClick={() => onSelectRepairType(type)}
							>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
									}}
								>
									<span
										style={{
											fontSize: "0.9rem",
											fontWeight: 500,
											color: selectedRepairType === type ? "#c4a77d" : "#aaa",
										}}
									>
										{type === "general"
											? "🔧 General"
											: type === "cleaning"
											? "🧹 Cleaning"
											: type === "descaling"
											? "🧴 Descaling"
											: type === "pump"
											? "⚙️ Pump"
											: "🔥 Heating"}
									</span>
									<span
										style={{
											fontSize: "0.85rem",
											color: machine.is_under_warranty && useWarrantyForRepair ? "#10b981" : "#c4a77d",
											fontWeight: 500,
										}}
									>
										{machine.is_under_warranty && useWarrantyForRepair
											? "FREE"
											: `${calculateRepairCost(Number(machine.unit_price ?? 0), type, false).toFixed(
													2
											  )} RON`}
									</span>
								</div>
							</div>
						))}
					</div>
				</div>

				{/* Cost Summary & Payment Selection - Show when user needs to pay */}
				{needsPayment && (
					<div style={{ padding: "0 1.5rem 1rem" }}>
						{/* Warning for expired warranty */}
						{!machine.is_under_warranty && (
							<div
								style={{
									padding: "1rem",
									backgroundColor: "rgba(245, 158, 11, 0.1)",
									borderRadius: "12px",
									border: "1px solid rgba(245, 158, 11, 0.3)",
									marginBottom: "1rem",
								}}
							>
								<div style={{ fontSize: "0.85rem", color: "#f59e0b" }}>
									⚠️ Warranty expired. Repair costs: 10-40% of original price.
								</div>
							</div>
						)}

						{/* Info for choosing to pay with warranty */}
						{machine.is_under_warranty && !useWarrantyForRepair ? (
							<div
								style={{
									padding: "1rem",
									backgroundColor: "rgba(196, 167, 125, 0.1)",
									borderRadius: "12px",
									border: "1px solid rgba(196, 167, 125, 0.3)",
									marginBottom: "1rem",
								}}
							>
								<div style={{ fontSize: "0.85rem", color: "#c4a77d" }}>
									💎 Premium service. Your warranty remains intact.
								</div>
							</div>
						) : null}

						{/* Payment Method Selection */}
						<h4 style={{ margin: "0 0 0.75rem", color: "#c4a77d", fontSize: "0.95rem", fontWeight: 600 }}>
							💳 Select Payment
						</h4>
						{savedCards.length === 0 ? (
							<div
								style={{
									padding: "1rem",
									backgroundColor: "rgba(196, 167, 125, 0.05)",
									borderRadius: "12px",
									border: "1px solid rgba(196, 167, 125, 0.2)",
									textAlign: "center",
								}}
							>
								<div style={{ color: "#888", fontSize: "0.9rem" }}>No saved cards. Add one during checkout.</div>
							</div>
						) : (
							<div
								style={{
									display: "grid",
									gridTemplateColumns: savedCards.length > 2 ? "1fr 1fr" : "1fr",
									gap: "0.5rem",
								}}
							>
								{savedCards.map((card) => (
									<div
										key={card.id}
										style={{
											padding: "0.85rem 1rem",
											backgroundColor:
												selectedRepairPaymentId === card.id
													? "rgba(196, 167, 125, 0.1)"
													: "rgba(196, 167, 125, 0.05)",
											borderRadius: "12px",
											border: `2px solid ${
												selectedRepairPaymentId === card.id ? "#c4a77d" : "rgba(196, 167, 125, 0.2)"
											}`,
											cursor: "pointer",
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											transition: "all 0.2s ease",
										}}
										onClick={() => onSelectPaymentId(card.id)}
									>
										<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
											<Image
												src={getCardTypeImage(card.card_type)}
												alt={card.card_type}
												width={36}
												height={24}
												style={{ borderRadius: "4px" }}
											/>
											<div>
												<span style={{ fontSize: "0.85rem", color: "#888" }}>
													<span
														style={{
															color: "#c4a77d",
															fontWeight: 500,
															fontFamily: "'Courier New', monospace",
														}}
													>
														•••• {card.card_last_four}
													</span>
												</span>
												<div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.15rem" }}>
													{card.card_type.charAt(0).toUpperCase() + card.card_type.slice(1)}
												</div>
											</div>
										</div>
										{selectedRepairPaymentId === card.id && (
											<span style={{ color: "#10b981", fontSize: "1rem" }}>✓</span>
										)}
									</div>
								))}
							</div>
						)}

						{/* Estimated Total */}
						<div
							style={{
								marginTop: "1rem",
								padding: "1rem",
								backgroundColor: "rgba(196, 167, 125, 0.1)",
								borderRadius: "12px",
								border: "1px solid rgba(196, 167, 125, 0.3)",
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
							}}
						>
							<span style={{ color: "#aaa", fontSize: "0.95rem" }}>Total:</span>
							<span style={{ color: "#c4a77d", fontWeight: 600, fontSize: "1.15rem" }}>
								{calculateRepairCost(Number(machine.unit_price ?? 0), selectedRepairType, false).toFixed(2)} RON
							</span>
						</div>
					</div>
				)}

				{/* Footer */}
				<div
					style={{
						padding: "1.25rem 1.5rem",
						borderTop: "1px solid rgba(196, 167, 125, 0.2)",
						display: "flex",
						justifyContent: "flex-end",
						gap: "0.75rem",
						position: "sticky",
						bottom: 0,
						backgroundColor: "#1a1a1a",
					}}
				>
					<button
						onClick={handleClose}
						style={{
							padding: "0.75rem 1.5rem",
							backgroundColor: "transparent",
							color: "#aaa",
							border: "1px solid rgba(196, 167, 125, 0.3)",
							borderRadius: "10px",
							cursor: "pointer",
							fontSize: "0.9rem",
							fontWeight: 500,
							transition: "all 0.2s ease",
						}}
					>
						Cancel
					</button>
					<button
						onClick={handleSubmit}
						disabled={submitDisabled}
						style={{
							padding: "0.75rem 1.5rem",
							backgroundColor: submitDisabled ? "#444" : "#c4a77d",
							color: submitDisabled ? "#888" : "#000",
							border: "none",
							borderRadius: "10px",
							cursor: submitDisabled ? "not-allowed" : "pointer",
							fontWeight: 600,
							fontSize: "0.9rem",
							transition: "all 0.2s ease",
						}}
					>
						{machine.is_under_warranty && useWarrantyForRepair ? "Submit Free Repair" : "Submit & Pay"}
					</button>
				</div>
			</div>
		</div>,
		document.body
	);
}
