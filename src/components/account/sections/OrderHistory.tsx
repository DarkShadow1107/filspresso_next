"use client";

import Image from "next/image";
import { Order, formatDate, gradientTextStyle, getCardTypeImage } from "./types";
import {
	ArrowNarrowLeftIcon,
	ArrowNarrowRightIcon,
	RosetteDiscountCheckIcon,
	TruckElectricIcon,
	ShoppingCartIcon,
	ClockIcon,
	TriangleAlertIcon,
	ArrowNarrowDownIcon,
	CoffeeIcon,
	RosetteDiscountIcon,
	SimpleCheckedIcon,
} from "@/icons";

type OrderHistoryProps = {
	orders: Order[];
	page?: number;
	totalPages?: number;
	onPageChange?: (page: number) => void;
	expandedOrders: Set<number>;
	loadingOrderItems: Set<number>;
	toggleOrderExpand: (id: number) => void;
	getProductImage: (productId: string) => string | undefined;
};

export function OrderHistory({
	orders,
	page = 1,
	totalPages = 1,
	onPageChange,
	expandedOrders,
	loadingOrderItems,
	toggleOrderExpand,
	getProductImage,
}: OrderHistoryProps) {
	const formatAmount = (value: number, currencyCode: string) => {
		return `${value.toFixed(2)} ${currencyCode.toUpperCase()}`;
	};

	const getStatusColor = (status: string) => {
		const colors: Record<string, string> = {
			pending: "#f59e0b",
			confirmed: "#3b82f6",
			processing: "#8b5cf6",
			shipped: "#06b6d4",
			delivered: "#10b981",
			cancelled: "#ef4444",
		};
		return colors[status] || "#6b7280";
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
					<ArrowNarrowLeftIcon size={16} />
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
					<ArrowNarrowRightIcon size={16} />
				</button>
			</div>
		);
	};

	return (
		<div className="card">
			<h2 style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
				<ShoppingCartIcon size={24} /> Order History
			</h2>
			{orders.length === 0 ? (
				<p className="empty-state">No orders found.</p>
			) : (
				<div
					key={`orders-page-${page}`}
					className="orders-list"
					style={{ display: "flex", flexDirection: "column", gap: "1rem", animation: "pager-fade-slide 0.35s ease" }}
				>
					{orders.map((order) => {
						// Ensure numeric values
						const total = Number(order.total) || 0;
						const currencyCode = String(order.currency_code || "RON").toUpperCase();
						const exchangeRate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
						const chargedTotal = Number(order.charged_total) || total * exchangeRate;
						// Get shipping from database
						const shippingCost = Number(order.shipping_cost) || 0;
						const tax = Number(order.tax) || 0;
						const discountAmount = Number(order.discount_amount) || 0;
						const rawSubtotal = Number(order.subtotal) || 0;
						const subtotal = Math.max(0, rawSubtotal - discountAmount);
						const chargedSubtotal = Number(order.charged_subtotal) || subtotal * exchangeRate;
						const chargedShippingCost = Number(order.charged_shipping_cost) || shippingCost * exchangeRate;
						const chargedTax = Number(order.charged_tax) || tax * exchangeRate;
						const isForeignCurrency = currencyCode !== "RON";
						const isExpanded = expandedOrders.has(order.id);
						const isLoading = loadingOrderItems.has(order.id);

						return (
							<div
								key={order.id}
								className="order-item"
								style={{
									border: "1px solid #333",
									borderRadius: "12px",
									overflow: "hidden",
									transition: "all 0.3s ease",
									background: "#121212",
									boxShadow: isExpanded ? "0 8px 24px rgba(0,0,0,0.5)" : "0 2px 4px rgba(0,0,0,0.2)",
								}}
							>
								{/* Order Header - Click to expand */}
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										padding: "1.5rem",
										cursor: "pointer",
										background: isExpanded ? "#1a1a1a" : "#121212",
										borderBottom: isExpanded ? "1px solid #333" : "none",
									}}
									onClick={() => toggleOrderExpand(order.id)}
								>
									<div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
										{/* Status Icon/Badge */}
										<div
											style={{
												width: "48px",
												height: "48px",
												borderRadius: "12px",
												background: getStatusColor(order.status) + "15",
												color: getStatusColor(order.status),
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
											}}
										>
											{order.status === "delivered" ? (
												<RosetteDiscountCheckIcon size={24} />
											) : order.status === "shipped" ? (
												<TruckElectricIcon size={24} />
											) : (
												<ShoppingCartIcon size={24} />
											)}
										</div>

										<div>
											<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
												<span
													style={{
														fontWeight: 700,
														fontSize: "1.1rem",
														...gradientTextStyle,
													}}
												>
													Order #{order.order_number.split("-")[1] || order.order_number}
												</span>
												<span
													style={{
														background: getStatusColor(order.status) + "15",
														color: getStatusColor(order.status),
														padding: "4px 10px",
														borderRadius: "6px",
														fontSize: "0.75rem",
														fontWeight: 700,
														textTransform: "uppercase",
														letterSpacing: "0.5px",
													}}
												>
													{order.status}
												</span>
											</div>
											<div
												style={{
													fontSize: "0.9rem",
													color: "#aaa",
													marginTop: "0.25rem",
													display: "flex",
													alignItems: "center",
													gap: "0.5rem",
												}}
											>
												<span
													style={{
														color: "#e5e5e5",
														display: "flex",
														alignItems: "center",
														gap: "0.4rem",
													}}
												>
													<ClockIcon size={14} />{" "}
													{formatDate(
														order.created_at instanceof Date
															? order.created_at.toISOString()
															: order.created_at,
													)}
												</span>
												<span>•</span>
												<span>{order.item_count || 0} items</span>
												{order.estimated_delivery && (
													<>
														<span>•</span>
														<span
															style={{
																color:
																	order.weather_condition === "snow"
																		? "#87CEEB"
																		: order.weather_condition === "rain"
																			? "#6BB3F8"
																			: "#4ade80",
																fontWeight: 500,
																display: "flex",
																alignItems: "center",
																gap: "0.4rem",
															}}
														>
															{order.weather_condition === "snow" ||
															order.weather_condition === "rain" ? (
																<TriangleAlertIcon size={14} />
															) : (
																<TruckElectricIcon size={14} />
															)}{" "}
															{order.estimated_delivery}
														</span>
													</>
												)}
											</div>
										</div>
									</div>

									<div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
										<div style={{ textAlign: "right" }}>
											<div style={{ fontSize: "0.85rem", color: "#aaa", marginBottom: "2px" }}>
												Total Amount
											</div>
											<div
												style={{
													fontWeight: 700,
													fontSize: "1.25rem",
													...gradientTextStyle,
												}}
											>
												{isForeignCurrency
													? formatAmount(chargedTotal, currencyCode)
													: formatAmount(total, "RON")}
											</div>
											{isForeignCurrency && (
												<div style={{ fontSize: "0.78rem", color: "#949494" }}>
													{formatAmount(total, "RON")}
												</div>
											)}
										</div>
										<div
											style={{
												width: "32px",
												height: "32px",
												borderRadius: "50%",
												background: "#222",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												transition: "transform 0.3s ease",
												transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
											}}
										>
											<ArrowNarrowDownIcon size={16} color="#aaa" />
										</div>
									</div>
								</div>

								{/* Expanded Order Items */}
								{isExpanded && (
									<div
										style={{
											padding: "0",
											background: "#121212",
											animation: "slideDown 0.3s ease-out",
										}}
									>
										{isLoading ? (
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
												Loading order details...
											</div>
										) : order.items && order.items.length > 0 ? (
											<div>
												{/* Items List */}
												<div style={{ padding: "0 1.5rem" }}>
													{order.items.map((item) => {
														const unitPrice = Number(item.unit_price) || 0;
														const totalPrice = Number(item.total_price) || 0;
														const chargedUnitPrice = unitPrice * exchangeRate;
														const chargedItemTotal = totalPrice * exchangeRate;
														const img =
															item.product_image ||
															(item.product_id ? getProductImage(item.product_id) : undefined);

														return (
															<div
																key={item.id}
																style={{
																	display: "flex",
																	alignItems: "center",
																	padding: "1.25rem 0",
																	borderBottom: "1px solid #333",
																}}
															>
																{/* Product Image */}
																<div
																	style={{
																		width: 80,
																		height: 80,
																		borderRadius: "8px",
																		background: "#222",
																		display: "flex",
																		alignItems: "center",
																		justifyContent: "center",
																		marginRight: "1.5rem",
																		overflow: "hidden",
																		border: "1px solid #333",
																	}}
																>
																	{img ? (
																		<Image
																			src={img}
																			alt={item.product_name}
																			width={80}
																			height={80}
																			style={{
																				objectFit: "contain",
																				padding: "4px",
																			}}
																		/>
																	) : (
																		<CoffeeIcon size={32} color="#444" />
																	)}
																</div>

																{/* Product Details */}
																<div style={{ flex: 1 }}>
																	<div
																		style={{
																			fontWeight: 600,
																			fontSize: "1.05rem",
																			...gradientTextStyle,
																			marginBottom: "0.25rem",
																		}}
																	>
																		{item.product_name}
																	</div>
																	<div style={{ fontSize: "0.9rem", color: "#aaa" }}>
																		Quantity:{" "}
																		<strong style={{ color: "#ccc" }}>{item.quantity}</strong>
																	</div>
																</div>

																{/* Price */}
																<div style={{ textAlign: "right" }}>
																	<div
																		style={{
																			fontSize: "0.85rem",
																			color: "#aaa",
																			marginBottom: "2px",
																		}}
																	>
																		{isForeignCurrency
																			? `${chargedUnitPrice.toFixed(2)} ${currencyCode} / unit`
																			: `${unitPrice.toFixed(2)} RON / unit`}
																	</div>
																	<div
																		style={{
																			fontWeight: 700,
																			fontSize: "1.1rem",
																			...gradientTextStyle,
																		}}
																	>
																		{isForeignCurrency
																			? `${chargedItemTotal.toFixed(2)} ${currencyCode}`
																			: `${totalPrice.toFixed(2)} RON`}
																	</div>
																	{isForeignCurrency && (
																		<div style={{ fontSize: "0.78rem", color: "#949494" }}>
																			{totalPrice.toFixed(2)} RON
																		</div>
																	)}
																</div>
															</div>
														);
													})}
												</div>

												{/* Order Summary Footer */}
												<div
													style={{
														background: "#1a1a1a",
														padding: "1.5rem",
														borderTop: "1px solid #333",
														marginTop: "0.5rem",
													}}
												>
													<div style={{ display: "flex", justifyContent: "flex-end" }}>
														<div style={{ width: "100%", maxWidth: "400px" }}>
															<div
																style={{
																	display: "flex",
																	justifyContent: "space-between",
																	marginBottom: "0.5rem",
																	fontSize: "0.95rem",
																	color: "#aaa",
																}}
															>
																<span>Subtotal</span>
																<span>
																	{isForeignCurrency
																		? formatAmount(chargedSubtotal, currencyCode)
																		: formatAmount(subtotal, "RON")}
																</span>
															</div>
															{/* Member Discount */}
															{order.discount_tier && Number(order.discount_amount) > 0 && (
																<div
																	style={{
																		display: "flex",
																		justifyContent: "space-between",
																		marginBottom: "0.5rem",
																		fontSize: "0.95rem",
																		color: "#10b981",
																	}}
																>
																	<span
																		style={{
																			display: "flex",
																			alignItems: "center",
																			gap: "0.35rem",
																		}}
																	>
																		<RosetteDiscountIcon size={16} />
																		{order.discount_tier} Discount ({order.discount_percent}
																		%)
																	</span>
																	<span>
																		-
																		{isForeignCurrency
																			? (
																					Number(order.discount_amount) * exchangeRate
																				).toFixed(2) +
																				" " +
																				currencyCode
																			: Number(order.discount_amount).toFixed(2) + " RON"}
																	</span>
																</div>
															)}
															<div
																style={{
																	display: "flex",
																	justifyContent: "space-between",
																	marginBottom: "0.5rem",
																	fontSize: "0.95rem",
																	color: "#aaa",
																}}
															>
																<span>Shipping</span>
																<span>
																	{shippingCost === 0 ? (
																		<span style={{ color: "#10b981" }}>Free</span>
																	) : isForeignCurrency ? (
																		`${chargedShippingCost.toFixed(2)} ${currencyCode}`
																	) : (
																		`${shippingCost.toFixed(2)} RON`
																	)}
																</span>
															</div>
															<div
																style={{
																	display: "flex",
																	justifyContent: "space-between",
																	marginBottom: "1rem",
																	fontSize: "0.95rem",
																	color: "#aaa",
																}}
															>
																<span>{isForeignCurrency ? "Conversion tax" : "Tax"}</span>
																<span>
																	{isForeignCurrency
																		? `${chargedTax.toFixed(2)} ${currencyCode}`
																		: `${tax.toFixed(2)} RON`}
																</span>
															</div>
															{isForeignCurrency && (
																<div
																	style={{
																		display: "flex",
																		justifyContent: "space-between",
																		marginBottom: "1rem",
																		fontSize: "0.85rem",
																		color: "#999",
																	}}
																>
																	<span>RON equivalent total</span>
																	<span>{total.toFixed(2)} RON</span>
																</div>
															)}
															<div
																style={{
																	justifyContent: "space-between",
																	paddingTop: "1rem",
																	borderTop: "1px dashed #444",
																	fontWeight: 700,
																	fontSize: "1.2rem",
																	background:
																		"linear-gradient(135deg, rgb(196, 167, 125) 0%, rgb(166, 124, 82) 100%)",
																	WebkitBackgroundClip: "text",
																	WebkitTextFillColor: "transparent",
																	backgroundClip: "text",
																	display: "flex",
																}}
															>
																<span>Total</span>
																<span>
																	{isForeignCurrency
																		? formatAmount(chargedTotal, currencyCode)
																		: formatAmount(total, "RON")}
																</span>
															</div>

															{/* Expected Delivery Date */}
															{(order.expected_delivery_date || order.estimated_delivery) && (
																<div
																	style={{
																		display: "flex",
																		justifyContent: "space-between",
																		alignItems: "center",
																		marginTop: "1rem",
																		paddingTop: "1rem",
																		borderTop: "1px solid #333",
																		fontSize: "0.95rem",
																		gap: "1.5rem",
																	}}
																>
																	<span
																		style={{
																			color: "#aaa",
																			display: "flex",
																			alignItems: "center",
																			gap: "0.5rem",
																		}}
																	>
																		<span
																			style={{
																				fontSize: "1.1rem",
																				display: "flex",
																				alignItems: "center",
																			}}
																		>
																			{order.weather_condition === "snow" ||
																			order.weather_condition === "rain" ? (
																				<TriangleAlertIcon size={18} />
																			) : (
																				<TruckElectricIcon size={18} />
																			)}
																		</span>
																		Expected Delivery
																	</span>
																	<span
																		style={{
																			fontWeight: 600,
																			display: "flex",
																			alignItems: "center",
																			gap: "0.4rem",
																			color:
																				order.status === "delivered"
																					? "#10b981"
																					: "#c4a77d",
																		}}
																	>
																		{order.status === "delivered" ? (
																			<>
																				<SimpleCheckedIcon size={16} /> Delivered
																			</>
																		) : order.expected_delivery_date ? (
																			formatDate(order.expected_delivery_date)
																		) : (
																			order.estimated_delivery
																		)}
																	</span>
																</div>
															)}

															{/* Payment Card Info */}
															{order.card_type && order.card_last_four && (
																<div
																	style={{
																		display: "flex",
																		alignItems: "center",
																		gap: "0.75rem",
																		marginTop: "1rem",
																		paddingTop: "1rem",
																		borderTop: "1px solid #333",
																	}}
																>
																	<Image
																		src={getCardTypeImage(order.card_type)}
																		alt={order.card_type}
																		width={36}
																		height={24}
																		style={{ borderRadius: "4px" }}
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
																			•••• {order.card_last_four}
																		</span>
																	</span>
																</div>
															)}
														</div>
													</div>
												</div>
											</div>
										) : (
											<div style={{ textAlign: "center", padding: "2rem", color: "#888" }}>
												No item details available.
											</div>
										)}
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
