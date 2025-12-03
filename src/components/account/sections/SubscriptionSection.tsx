"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { formatDate, getCardTypeImage, SubscriptionData } from "./types";

type SubscriptionSectionProps = {
	subscription: string;
	subscriptionData: SubscriptionData | null;
};

export function SubscriptionSection({ subscription, subscriptionData }: SubscriptionSectionProps) {
	const router = useRouter();

	return (
		<div className="tab-pane fade-in">
			<div className="card subscription-card">
				<div className="sub-header">
					<div>
						<h2>Current Plan</h2>
						<p
							className="sub-status"
							style={{ color: subscriptionData?.is_active !== false ? "#10b981" : "#f59e0b" }}
						>
							● {subscriptionData?.is_active !== false ? "Active" : "Inactive"}
						</p>
					</div>
					<div className="sub-price">
						{subscriptionData?.price_ron && subscriptionData.price_ron > 0
							? `${subscriptionData.price_ron.toFixed(2)} RON`
							: "Free"}
						{subscriptionData?.price_ron && subscriptionData.price_ron > 0 && (
							<span>/{subscriptionData?.billing_cycle === "annual" ? "year" : "month"}</span>
						)}
					</div>
				</div>
				<div className="sub-details">
					<h3>
						{subscription === "none" || subscription === "free"
							? "Basic Access"
							: `${subscription.charAt(0).toUpperCase() + subscription.slice(1)} Tier`}
					</h3>

					{/* Renewal Date Info - Only for paid subscriptions */}
					{subscriptionData?.renewal_date && subscription !== "free" && subscription !== "none" && (
						<div
							style={{
								background: "rgba(196, 167, 125, 0.1)",
								border: "1px solid rgba(196, 167, 125, 0.3)",
								borderRadius: "12px",
								padding: "1rem 1.25rem",
								marginBottom: "1rem",
							}}
						>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
								<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
									<span style={{ fontSize: "1.5rem" }}>📅</span>
									<div>
										<div style={{ fontSize: "0.85rem", color: "#aaa" }}>
											{subscriptionData.auto_renew ? "Next Renewal" : "Access Until"}
										</div>
										<div style={{ fontWeight: 600, color: "#c4a77d", fontSize: "1.1rem" }}>
											{formatDate(subscriptionData.renewal_date)}
										</div>
									</div>
								</div>
								<div
									style={{
										background: subscriptionData.auto_renew
											? "rgba(16, 185, 129, 0.15)"
											: "rgba(245, 158, 11, 0.15)",
										color: subscriptionData.auto_renew ? "#10b981" : "#f59e0b",
										padding: "6px 12px",
										borderRadius: "8px",
										fontSize: "0.8rem",
										fontWeight: 600,
									}}
								>
									{subscriptionData.auto_renew ? "Auto-renew ON" : "Auto-renew OFF"}
								</div>
							</div>
							{subscriptionData.billing_cycle && (
								<div
									style={{
										marginTop: "0.75rem",
										paddingTop: "0.75rem",
										borderTop: "1px solid rgba(196, 167, 125, 0.2)",
										fontSize: "0.85rem",
										color: "#888",
									}}
								>
									Billing cycle:{" "}
									<span style={{ color: "#c4a77d", fontWeight: 500 }}>
										{subscriptionData.billing_cycle === "annual" ? "Annual" : "Monthly"}
									</span>
									{subscriptionData.start_date && (
										<>
											{" "}
											• Started:{" "}
											<span style={{ color: "#c4a77d", fontWeight: 500 }}>
												{formatDate(subscriptionData.start_date)}
											</span>
										</>
									)}
								</div>
							)}
							{/* Payment Card Info */}
							{subscriptionData.card && (
								<div
									style={{
										marginTop: "0.75rem",
										paddingTop: "0.75rem",
										borderTop: "1px solid rgba(196, 167, 125, 0.2)",
										display: "flex",
										alignItems: "center",
										gap: "0.75rem",
									}}
								>
									<Image
										src={getCardTypeImage(subscriptionData.card.type)}
										alt={subscriptionData.card.type}
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
											•••• {subscriptionData.card.last_four}
										</span>
									</span>
								</div>
							)}
						</div>
					)}

					<ul>
						<li>✅ Access to Kafelot Tanka</li>
						<li>{subscription !== "none" && subscription !== "free" ? "✅" : "❌"} Access to Kafelot Villanelle</li>
						<li>{subscription === "ultimate" ? "✅" : "❌"} Access to Kafelot Ode</li>
						<li>{subscription === "ultimate" ? "✅" : "❌"} Chemistry Mode & Visualizations</li>
					</ul>
				</div>
				<div className="sub-actions">
					<button
						className="btn-primary"
						onClick={() =>
							router.push(
								subscription === "none" || subscription === "free" ? "/subscription" : "/manage-subscription"
							)
						}
					>
						{subscription === "none" || subscription === "free" ? "Upgrade Plan" : "Manage Subscription"}
					</button>
				</div>
			</div>
		</div>
	);
}
