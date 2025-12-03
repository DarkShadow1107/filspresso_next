"use client";

import Image from "next/image";
import { Order, SavedCard, Repair, gradientTextStyle, getCardTypeImage } from "./types";
import { RepairsHistory } from "./RepairsHistory";
import { OrderHistory } from "./OrderHistory";

type PaymentsSectionProps = {
	savedCards: SavedCard[];
	orders: Order[];
	repairs: Repair[];
	expandedOrders: Set<number>;
	loadingOrderItems: Set<number>;
	toggleOrderExpand: (id: number) => void;
	handleDeleteCard: (id: number) => void;
	getProductImage: (productId: string) => string | undefined;
};

export function PaymentsSection({
	savedCards,
	orders,
	repairs,
	expandedOrders,
	loadingOrderItems,
	toggleOrderExpand,
	handleDeleteCard,
	getProductImage,
}: PaymentsSectionProps) {
	return (
		<div className="tab-pane fade-in">
			{/* Saved Cards Section */}
			<div className="card" style={{ marginBottom: "2rem" }}>
				<h2>💳 Saved Cards</h2>
				{savedCards.length === 0 ? (
					<p className="empty-state">No saved cards found. Add a card during checkout.</p>
				) : (
					<div
						className="saved-cards-grid"
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "1rem",
						}}
					>
						{savedCards.map((card) => (
							<div
								key={card.id}
								className="saved-card-item"
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "1.25rem 1rem",
									borderBottom: "1px solid #333",
									transition: "background 0.2s",
								}}
							>
								{/* Left side - Card details */}
								<div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
									<div style={{ minWidth: "220px" }}>
										<div
											style={{
												fontFamily: "'Courier New', monospace",
												fontSize: "1.2rem",
												letterSpacing: "3px",
												...gradientTextStyle,
												fontWeight: 700,
											}}
										>
											•••• •••• •••• {card.card_last_four}
										</div>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: "1.5rem",
												marginTop: "0.6rem",
												fontSize: "0.95rem",
											}}
										>
											<span style={{ color: "#aaa" }}>
												Expires:{" "}
												<strong style={{ ...gradientTextStyle, fontWeight: 600 }}>
													{card.card_expiry}
												</strong>
											</span>
											{card.is_default ? (
												<span
													style={{
														fontSize: "0.75rem",
														color: "#10b981",
														border: "1px solid #10b981",
														padding: "3px 10px",
														borderRadius: "12px",
														fontWeight: 600,
														background: "rgba(16, 185, 129, 0.1)",
													}}
												>
													Default
												</span>
											) : null}
										</div>
									</div>
								</div>{" "}
								{/* Right side - Card image and remove button */}
								<div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
									<div
										style={{
											width: 72,
											height: 46,
											position: "relative",
											background: "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)",
											borderRadius: "8px",
											padding: "6px",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											boxShadow: "0 2px 8px rgba(166, 124, 82, 0.3)",
										}}
									>
										<Image
											src={getCardTypeImage(card.card_type)}
											alt={card.card_type}
											width={58}
											height={36}
											style={{ objectFit: "contain" }}
										/>
									</div>
									<button
										onClick={(e) => {
											e.stopPropagation();
											handleDeleteCard(card.id);
										}}
										style={{
											background: "linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)",
											border: "1px solid #333",
											color: "#888",
											cursor: "pointer",
											fontSize: "0.85rem",
											padding: "8px 16px",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											gap: "6px",
											borderRadius: "8px",
											transition: "all 0.3s ease",
											fontWeight: 500,
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.background =
												"linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)";
											e.currentTarget.style.borderColor = "#dc2626";
											e.currentTarget.style.color = "#fff";
											e.currentTarget.style.boxShadow = "0 4px 12px rgba(220, 38, 38, 0.3)";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background =
												"linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)";
											e.currentTarget.style.borderColor = "#333";
											e.currentTarget.style.color = "#888";
											e.currentTarget.style.boxShadow = "none";
										}}
										title="Remove card"
									>
										<span style={{ fontSize: "1rem" }}>🗑️</span>
										Remove
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Repairs History Subcomponent */}
			<RepairsHistory repairs={repairs} />

			{/* Order History Subcomponent */}
			<OrderHistory
				orders={orders}
				expandedOrders={expandedOrders}
				loadingOrderItems={loadingOrderItems}
				toggleOrderExpand={toggleOrderExpand}
				getProductImage={getProductImage}
			/>
		</div>
	);
}
