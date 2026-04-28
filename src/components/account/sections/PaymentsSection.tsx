"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Order, SavedCard, Repair, gradientTextStyle, getCardTypeImage } from "./types";
import { RepairsHistory } from "./RepairsHistory";
import { OrderHistory } from "./OrderHistory";
import { TrashIcon, CreditCard, ArrowBackUpIcon, ArrowNarrowRightIcon, ArrowNarrowLeftIcon } from "@/icons";

type PaymentsSectionProps = {
	savedCards: SavedCard[];
	orders: Order[];
	repairs: Repair[];
	expandedOrders: Set<number>;
	loadingOrderItems: Set<number>;
	toggleOrderExpand: (id: number) => void;
	handleDeleteCard: (id: number) => void;
	getProductImage: (productId: string) => string | undefined;
	invoiceIncludeProductView: boolean;
	onInvoiceIncludeProductViewChange: (includeView: boolean) => void;
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
	invoiceIncludeProductView,
	onInvoiceIncludeProductViewChange,
}: PaymentsSectionProps) {
	// Pagination state
	const [cardPage, setCardPage] = useState(1);
	const [repairsPage, setRepairsPage] = useState(1);
	const [ordersPage, setOrdersPage] = useState(1);

	const CARDS_PER_PAGE = 3;
	const REPAIRS_PER_PAGE = 3;
	const ORDERS_PER_PAGE = 6;

	// Compute valid page bounds
	const maxCardPage = Math.max(1, Math.ceil(savedCards.length / CARDS_PER_PAGE));
	const maxRepairsPage = Math.max(1, Math.ceil(repairs.length / REPAIRS_PER_PAGE));
	const nonRepairOrders = orders.filter((o) => !o.order_number.startsWith("REP-"));
	const maxOrdersPage = Math.max(1, Math.ceil(nonRepairOrders.length / ORDERS_PER_PAGE));

	// Clamp pages to valid range
	const validCardPage = Math.min(Math.max(cardPage, 1), maxCardPage);
	const validRepairsPage = Math.min(Math.max(repairsPage, 1), maxRepairsPage);
	const validOrdersPage = Math.min(Math.max(ordersPage, 1), maxOrdersPage);

	// Paginated data slices
	const paginatedCards = savedCards.slice((validCardPage - 1) * CARDS_PER_PAGE, validCardPage * CARDS_PER_PAGE);
	const paginatedOrders = nonRepairOrders.slice((validOrdersPage - 1) * ORDERS_PER_PAGE, validOrdersPage * ORDERS_PER_PAGE);
	const paginatedRepairs = repairs.slice((validRepairsPage - 1) * REPAIRS_PER_PAGE, validRepairsPage * REPAIRS_PER_PAGE);

	const renderPager = (page: number, total: number, onChange: (p: number) => void) => {
		if (total <= 1) return null;
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
					onClick={() => onChange(Math.max(1, page - 1))}
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
					<ArrowNarrowLeftIcon size={16} />
				</button>
				<span style={{ alignSelf: "center", color: "#aaa", fontSize: "0.9rem" }}>
					Page {page} of {total}
				</span>
				<button
					onClick={() => onChange(Math.min(total, page + 1))}
					disabled={page === total}
					style={{
						padding: "8px 12px",
						borderRadius: 10,
						border: "1px solid #3a3a3a",
						background: page === total ? "#1a1a1a" : "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)",
						color: page === total ? "#666" : "#0f0f0f",
						cursor: page === total ? "not-allowed" : "pointer",
						fontWeight: 700,
						transition: "transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease",
						boxShadow: page === total ? "none" : "0 8px 16px rgba(166,124,82,0.35)",
						filter: page === total ? "grayscale(0.6)" : "none",
					}}
					onMouseEnter={(e) => {
						if (page === total) return;
						e.currentTarget.style.transform = "translateY(-2px)";
						e.currentTarget.style.boxShadow = "0 12px 20px rgba(166,124,82,0.45)";
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.transform = "translateY(0)";
						e.currentTarget.style.boxShadow = page === total ? "none" : "0 8px 16px rgba(166,124,82,0.35)";
					}}
				>
					<ArrowNarrowRightIcon size={16} />
				</button>
			</div>
		);
	};

	return (
		<div className="tab-pane fade-in">
			{/* Saved Cards Section */}
			<div className="card" style={{ marginBottom: "2rem" }}>
				<h2 style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
					<CreditCard size={28} /> Saved Cards
				</h2>
				{savedCards.length === 0 ? (
					<p className="empty-state">No saved cards found. Add a card during checkout.</p>
				) : (
					<div
						key={`cards-page-${cardPage}`}
						className="saved-cards-grid"
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "1rem",
							animation: "pager-fade-slide 0.35s ease",
						}}
					>
						{paginatedCards.map((card) => (
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
										<TrashIcon size={18} />
										Remove
									</button>
								</div>
							</div>
						))}
					</div>
				)}

				{renderPager(cardPage, Math.max(1, Math.ceil(savedCards.length / CARDS_PER_PAGE)), setCardPage)}
			</div>

			{/* Repairs History Subcomponent */}
			<RepairsHistory
				repairs={paginatedRepairs}
				page={repairsPage}
				totalPages={Math.max(1, Math.ceil(repairs.length / REPAIRS_PER_PAGE))}
				onPageChange={setRepairsPage}
			/>

			{/* Order History Subcomponent */}
			<div className="card" style={{ marginBottom: "1.25rem", padding: "1rem 1.2rem" }}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						gap: "1rem",
						flexWrap: "wrap",
					}}
				>
					<div>
						<div style={{ fontWeight: 700, marginBottom: "0.2rem", ...gradientTextStyle }}>Invoice Preferences</div>
						<div style={{ fontSize: "0.86rem", color: "#9ca3af" }}>
							Set a default for showing product images in invoice PDFs.
						</div>
					</div>
					<button
						type="button"
						onClick={() => onInvoiceIncludeProductViewChange(!invoiceIncludeProductView)}
						style={{
							padding: "10px 16px",
							borderRadius: 999,
							border: invoiceIncludeProductView
								? "1px solid rgba(196, 167, 125, 0.55)"
								: "1px solid rgba(120, 120, 120, 0.45)",
							background: invoiceIncludeProductView
								? "linear-gradient(135deg, rgba(196,167,125,0.28), rgba(166,124,82,0.35))"
								: "linear-gradient(135deg, rgba(60,60,60,0.35), rgba(40,40,40,0.45))",
							color: invoiceIncludeProductView ? "#f1dfc8" : "#c4c4c4",
							fontWeight: 700,
							letterSpacing: "0.2px",
							cursor: "pointer",
							transition: "all 0.2s ease",
							boxShadow: invoiceIncludeProductView
								? "0 8px 20px rgba(166,124,82,0.22)"
								: "0 4px 10px rgba(0,0,0,0.25)",
						}}
					>
						{invoiceIncludeProductView ? "View Column: ON" : "View Column: OFF"}
					</button>
				</div>
			</div>

			<OrderHistory
				orders={paginatedOrders}
				page={ordersPage}
				totalPages={Math.max(1, Math.ceil(nonRepairOrders.length / ORDERS_PER_PAGE))}
				onPageChange={setOrdersPage}
				expandedOrders={expandedOrders}
				loadingOrderItems={loadingOrderItems}
				toggleOrderExpand={toggleOrderExpand}
				getProductImage={getProductImage}
			/>
		</div>
	);
}
