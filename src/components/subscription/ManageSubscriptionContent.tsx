"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useNotifications } from "@/components/NotificationsProvider";
import { buildPageHref } from "@/lib/pages";

type Subscription = {
	id?: number;
	tier: string;
	billing_cycle: "monthly" | "annual" | null;
	price_ron: number;
	start_date: string | null;
	renewal_date: string | null;
	end_date?: string | null;
	is_active: boolean;
	auto_renew: boolean;
	status?: "active" | "ending" | "scheduled" | "cancelled";
	card?: {
		id: number;
		last_four: string;
		type: string;
	} | null;
};

type ScheduledSubscription = {
	tier: string;
	billing_cycle: "monthly" | "annual";
	price_ron: number;
	start_date: string;
	renewal_date: string;
	status: "scheduled";
};

type SavedCard = {
	id: number;
	card_holder: string;
	card_type: string;
	card_last_four: string;
	card_expiry: string;
	is_default: boolean;
};

const SUBSCRIPTION_PRICES = {
	free: { monthly: 0, annual: 0 },
	basic: { monthly: 55.99, annual: 399.99 },
	plus: { monthly: 109.99, annual: 1099.99 },
	pro: { monthly: 169.99, annual: 1699.99 },
	max: { monthly: 279.99, annual: 2699.99 },
	ultimate: { monthly: 599.99, annual: 6299.99 },
};

const getCardTypeImage = (cardType: string): string => {
	const type = cardType?.toLowerCase() || "unknown";
	const imageMap: Record<string, string> = {
		visa: "/images/Payment/Visa.png",
		mastercard: "/images/Payment/Mastercard.png",
		amex: "/images/Payment/American_Express.png",
		"american express": "/images/Payment/American_Express.png",
		discover: "/images/Payment/Discover.png",
	};
	return imageMap[type] || "/images/Payment/Visa.png";
};

const formatDate = (dateString: string | null) => {
	if (!dateString) return "N/A";
	try {
		const date = new Date(dateString);
		if (isNaN(date.getTime())) return "N/A";
		return date.toLocaleDateString("en-US", {
			weekday: "short",
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	} catch {
		return "N/A";
	}
};

export default function ManageSubscriptionContent() {
	const router = useRouter();
	const { notify } = useNotifications();
	const [subscription, setSubscription] = useState<Subscription | null>(null);
	const [scheduledSubscription, setScheduledSubscription] = useState<ScheduledSubscription | null>(null);
	const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
	const [loading, setLoading] = useState(true);
	const [showCancelModal, setShowCancelModal] = useState(false);
	const [showChangeCardModal, setShowChangeCardModal] = useState(false);
	const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
	const [updatingCard, setUpdatingCard] = useState(false);
	const [hoveredButton, setHoveredButton] = useState<string | null>(null);

	useEffect(() => {
		const fetchData = async () => {
			const session = sessionStorage.getItem("account_session");
			if (!session) {
				router.push(buildPageHref("account"));
				return;
			}

			try {
				const { token } = JSON.parse(session);

				// Fetch subscription
				const subRes = await fetch("http://localhost:4000/api/subscriptions", {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (subRes.ok) {
					const data = await subRes.json();
					setSubscription(data.subscription);
					setScheduledSubscription(data.scheduled || null);
					if (data.subscription?.card?.id) {
						setSelectedCardId(data.subscription.card.id);
					}
				}

				// Fetch saved cards
				const cardsRes = await fetch("http://localhost:4000/api/cards", {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (cardsRes.ok) {
					const data = await cardsRes.json();
					setSavedCards(data.cards || []);
				}
			} catch (error) {
				console.error("Failed to fetch data:", error);
				notify("Failed to load subscription data", 5000, "error", "subscription");
			} finally {
				setLoading(false);
			}
		};

		fetchData();
	}, [router, notify]);

	const handleCancelSubscription = async () => {
		const session = sessionStorage.getItem("account_session");
		if (!session) return;

		try {
			const { token } = JSON.parse(session);
			const res = await fetch("http://localhost:4000/api/subscriptions/cancel", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
			});

			if (res.ok) {
				notify(
					"Subscription cancelled. You'll retain access until the end of your billing period.",
					6000,
					"success",
					"subscription"
				);
				setShowCancelModal(false);
				// Refresh subscription data
				const subRes = await fetch("http://localhost:4000/api/subscriptions", {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (subRes.ok) {
					const data = await subRes.json();
					setSubscription(data.subscription);
					setScheduledSubscription(data.scheduled || null);
				}
			} else {
				notify("Failed to cancel subscription", 5000, "error", "subscription");
			}
		} catch (error) {
			console.error("Cancel error:", error);
			notify("An error occurred", 5000, "error", "subscription");
		}
	};

	const handleUpdatePaymentMethod = async () => {
		if (!selectedCardId) {
			notify("Please select a card", 3000, "error", "subscription");
			return;
		}

		const session = sessionStorage.getItem("account_session");
		if (!session) return;

		setUpdatingCard(true);
		try {
			const { token } = JSON.parse(session);
			const res = await fetch("http://localhost:4000/api/subscriptions/update-card", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ cardId: selectedCardId }),
			});

			if (res.ok) {
				notify("Payment method updated successfully!", 4000, "success", "subscription");
				setShowChangeCardModal(false);
				// Refresh subscription data
				const subRes = await fetch("http://localhost:4000/api/subscriptions", {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (subRes.ok) {
					const data = await subRes.json();
					setSubscription(data.subscription);
					setScheduledSubscription(data.scheduled || null);
				}
			} else {
				notify("Failed to update payment method", 5000, "error", "subscription");
			}
		} catch (error) {
			console.error("Update card error:", error);
			notify("An error occurred", 5000, "error", "subscription");
		} finally {
			setUpdatingCard(false);
		}
	};

	const handleToggleAutoRenew = async () => {
		const session = sessionStorage.getItem("account_session");
		if (!session) return;

		try {
			const { token } = JSON.parse(session);
			const res = await fetch("http://localhost:4000/api/subscriptions/toggle-auto-renew", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
			});

			if (res.ok) {
				const newState = !subscription?.auto_renew;
				notify(
					newState ? "Auto-renewal enabled" : "Auto-renewal disabled. Your subscription will end on the renewal date.",
					4000,
					"success",
					"subscription"
				);
				setSubscription((prev) => (prev ? { ...prev, auto_renew: newState } : null));
			} else {
				notify("Failed to update auto-renewal", 5000, "error", "subscription");
			}
		} catch (error) {
			console.error("Toggle auto-renew error:", error);
			notify("An error occurred", 5000, "error", "subscription");
		}
	};

	if (loading) {
		return (
			<div
				className="manage-subscription-page"
				style={{
					minHeight: "100vh",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)",
				}}
			>
				<div className="loading-spinner" style={{ color: "#c4a77d" }}>
					Loading...
				</div>
			</div>
		);
	}

	if (!subscription || subscription.tier === "free") {
		router.push("/subscription");
		return null;
	}

	const tierName = subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1);

	return (
		<div
			className="manage-subscription-page"
			style={{
				minHeight: "100vh",
				padding: "2rem",
				background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)",
			}}
		>
			{/* Header */}
			<div style={{ maxWidth: "800px", margin: "0 auto" }}>
				<h1
					style={{
						fontSize: "2.5rem",
						fontWeight: 700,
						marginBottom: "0.5rem",
						background: "linear-gradient(135deg, #c4a77d 0%, #d4b896 100%)",
						WebkitBackgroundClip: "text",
						WebkitTextFillColor: "transparent",
					}}
				>
					Manage Subscription
				</h1>
				<p style={{ color: "#888", marginBottom: "2rem" }}>
					Update your plan, payment method, or cancel your subscription
				</p>

				{/* Current Plan Card */}
				<div
					style={{
						background: "linear-gradient(145deg, #1a1a1a 0%, #0d0d0d 100%)",
						border: "1px solid #333",
						borderRadius: "16px",
						padding: "2rem",
						marginBottom: "1.5rem",
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "flex-start",
							marginBottom: "1.5rem",
						}}
					>
						<div>
							<div style={{ fontSize: "0.85rem", color: "#888", marginBottom: "0.25rem" }}>Current Plan</div>
							<h2 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#fff", margin: 0 }}>{tierName}</h2>
						</div>
						<div style={{ textAlign: "right" }}>
							<div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#c4a77d" }}>
								{subscription.price_ron.toFixed(2)} RON
							</div>
							<div style={{ fontSize: "0.85rem", color: "#888" }}>
								per {subscription.billing_cycle === "annual" ? "year" : "month"}
							</div>
						</div>
					</div>

					{/* Status Badge */}
					<div
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: "0.5rem",
							background:
								subscription.status === "ending"
									? "rgba(245, 158, 11, 0.15)"
									: subscription.is_active
									? "rgba(16, 185, 129, 0.15)"
									: "rgba(239, 68, 68, 0.15)",
							color: subscription.status === "ending" ? "#f59e0b" : subscription.is_active ? "#10b981" : "#ef4444",
							padding: "6px 12px",
							borderRadius: "8px",
							fontSize: "0.85rem",
							fontWeight: 600,
							marginBottom: "1.5rem",
						}}
					>
						<span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "currentColor" }} />
						{subscription.status === "ending" ? "Ending Soon" : subscription.is_active ? "Active" : "Cancelled"}
					</div>

					{/* Renewal Info */}
					<div
						style={{
							background: "#0a0a0a",
							borderRadius: "12px",
							padding: "1rem 1.25rem",
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							flexWrap: "wrap",
							gap: "1rem",
						}}
					>
						<div>
							<div style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.25rem" }}>
								{subscription.status === "ending"
									? "Access ends on"
									: subscription.auto_renew
									? "Next billing date"
									: "Access until"}
							</div>
							<div
								style={{
									fontSize: "1.1rem",
									fontWeight: 600,
									color: subscription.status === "ending" ? "#f59e0b" : "#fff",
								}}
							>
								{formatDate(
									subscription.status === "ending" ? subscription.end_date ?? null : subscription.renewal_date
								)}
							</div>
						</div>
						{subscription.status !== "ending" && (
							<button
								onClick={handleToggleAutoRenew}
								style={{
									background: subscription.auto_renew ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
									color: subscription.auto_renew ? "#10b981" : "#f59e0b",
									border: "none",
									padding: "8px 16px",
									borderRadius: "8px",
									fontSize: "0.85rem",
									fontWeight: 600,
									cursor: "pointer",
									transition: "all 0.2s",
								}}
							>
								{subscription.auto_renew ? "✓ Auto-renew ON" : "Auto-renew OFF"}
							</button>
						)}
					</div>
				</div>

				{/* Scheduled Subscription Card */}
				{scheduledSubscription && (
					<div
						style={{
							background: "linear-gradient(145deg, #1a2f1a 0%, #0d1a0d 100%)",
							border: "1px solid #2d5a2d",
							borderRadius: "16px",
							padding: "2rem",
							marginBottom: "1.5rem",
						}}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "flex-start",
								marginBottom: "1.5rem",
							}}
						>
							<div>
								<div style={{ fontSize: "0.85rem", color: "#4ade80", marginBottom: "0.25rem" }}>
									Upcoming Plan
								</div>
								<h2 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#fff", margin: 0 }}>
									{scheduledSubscription.tier.charAt(0).toUpperCase() + scheduledSubscription.tier.slice(1)}
								</h2>
							</div>
							<div style={{ textAlign: "right" }}>
								<div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#4ade80" }}>
									{scheduledSubscription.price_ron.toFixed(2)} RON
								</div>
								<div style={{ fontSize: "0.85rem", color: "#888" }}>
									per {scheduledSubscription.billing_cycle === "annual" ? "year" : "month"}
								</div>
							</div>
						</div>

						{/* Status Badge */}
						<div
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: "0.5rem",
								background: "rgba(74, 222, 128, 0.15)",
								color: "#4ade80",
								padding: "6px 12px",
								borderRadius: "8px",
								fontSize: "0.85rem",
								fontWeight: 600,
								marginBottom: "1.5rem",
							}}
						>
							<span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "currentColor" }} />
							Scheduled
						</div>

						{/* Start Date Info */}
						<div
							style={{
								background: "rgba(0, 0, 0, 0.3)",
								borderRadius: "12px",
								padding: "1rem 1.25rem",
							}}
						>
							<div style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.25rem" }}>Starts on</div>
							<div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#4ade80" }}>
								{formatDate(scheduledSubscription.start_date)}
							</div>
						</div>
					</div>
				)}

				{/* Payment Method Card */}
				<div
					style={{
						background: "linear-gradient(145deg, #1a1a1a 0%, #0d0d0d 100%)",
						border: "1px solid #333",
						borderRadius: "16px",
						padding: "2rem",
						marginBottom: "1.5rem",
					}}
				>
					<h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#fff", marginBottom: "1rem" }}>Payment Method</h3>

					{subscription.card ? (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								background: "#0a0a0a",
								borderRadius: "12px",
								padding: "1rem 1.25rem",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
								<Image
									src={getCardTypeImage(subscription.card.type)}
									alt={subscription.card.type}
									width={48}
									height={32}
									style={{ borderRadius: "4px" }}
								/>
								<div>
									<div style={{ fontFamily: "'Courier New', monospace", color: "#fff", fontSize: "1rem" }}>
										•••• •••• •••• {subscription.card.last_four}
									</div>
									<div style={{ fontSize: "0.8rem", color: "#888", textTransform: "capitalize" }}>
										{subscription.card.type}
									</div>
								</div>
							</div>
							<button
								onClick={() => setShowChangeCardModal(true)}
								style={{
									background: "transparent",
									border: "1px solid #444",
									color: "#c4a77d",
									padding: "8px 16px",
									borderRadius: "8px",
									fontSize: "0.85rem",
									cursor: "pointer",
									transition: "all 0.2s",
								}}
							>
								Change
							</button>
						</div>
					) : (
						<div
							style={{
								background: "#0a0a0a",
								borderRadius: "12px",
								padding: "1.5rem",
								textAlign: "center",
								color: "#888",
							}}
						>
							<p>No payment method on file</p>
							<button
								onClick={() => setShowChangeCardModal(true)}
								style={{
									background: "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)",
									color: "#000",
									border: "none",
									padding: "10px 20px",
									borderRadius: "8px",
									fontSize: "0.9rem",
									fontWeight: 600,
									cursor: "pointer",
									marginTop: "0.75rem",
								}}
							>
								Add Payment Method
							</button>
						</div>
					)}
				</div>

				{/* Actions */}
				<div
					style={{
						display: "flex",
						gap: "1rem",
						flexWrap: "wrap",
					}}
				>
					<button
						onClick={() => router.push(buildPageHref("subscription"))}
						onMouseEnter={() => setHoveredButton("change")}
						onMouseLeave={() => setHoveredButton(null)}
						style={{
							flex: 1,
							minWidth: "180px",
							background:
								hoveredButton === "change"
									? "linear-gradient(135deg, #d4b896 0%, #b68c62 100%)"
									: "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)",
							color: "#000",
							border: "none",
							padding: "14px 24px",
							borderRadius: "12px",
							fontSize: "1rem",
							fontWeight: 600,
							cursor: "pointer",
							transition: "all 0.2s",
							transform: hoveredButton === "change" ? "translateY(-2px)" : "none",
							boxShadow: hoveredButton === "change" ? "0 4px 12px rgba(196, 167, 125, 0.4)" : "none",
						}}
					>
						Change Plan
					</button>
					<button
						onClick={() => setShowCancelModal(true)}
						onMouseEnter={() => setHoveredButton("cancel")}
						onMouseLeave={() => setHoveredButton(null)}
						disabled={!subscription.is_active || !subscription.auto_renew}
						style={{
							flex: 1,
							minWidth: "180px",
							background:
								hoveredButton === "cancel" && subscription.is_active && subscription.auto_renew
									? "rgba(239, 68, 68, 0.1)"
									: "transparent",
							color: subscription.is_active && subscription.auto_renew ? "#ef4444" : "#666",
							border: `1px solid ${subscription.is_active && subscription.auto_renew ? "#ef4444" : "#333"}`,
							padding: "14px 24px",
							borderRadius: "12px",
							fontSize: "1rem",
							fontWeight: 600,
							cursor: subscription.is_active && subscription.auto_renew ? "pointer" : "not-allowed",
							transition: "all 0.2s",
							opacity: subscription.is_active && subscription.auto_renew ? 1 : 0.5,
							transform:
								hoveredButton === "cancel" && subscription.is_active && subscription.auto_renew
									? "translateY(-2px)"
									: "none",
							boxShadow:
								hoveredButton === "cancel" && subscription.is_active && subscription.auto_renew
									? "0 4px 12px rgba(239, 68, 68, 0.3)"
									: "none",
						}}
					>
						Cancel Subscription
					</button>
					<button
						onClick={() => router.push(buildPageHref("account"))}
						onMouseEnter={() => setHoveredButton("back")}
						onMouseLeave={() => setHoveredButton(null)}
						style={{
							flex: 1,
							minWidth: "180px",
							background: hoveredButton === "back" ? "#444" : "#333",
							color: "#fff",
							border: hoveredButton === "back" ? "1px solid #555" : "1px solid #444",
							padding: "14px 24px",
							borderRadius: "12px",
							fontSize: "1rem",
							fontWeight: 600,
							cursor: "pointer",
							transition: "all 0.2s",
							transform: hoveredButton === "back" ? "translateY(-2px)" : "none",
							boxShadow: hoveredButton === "back" ? "0 4px 12px rgba(0, 0, 0, 0.3)" : "none",
						}}
					>
						← Back to Account
					</button>
				</div>
			</div>

			{/* Cancel Modal */}
			{showCancelModal && (
				<div
					style={{
						position: "fixed",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						background: "rgba(0, 0, 0, 0.8)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 1000,
						padding: "1rem",
					}}
				>
					<div
						style={{
							background: "#1a1a1a",
							borderRadius: "16px",
							padding: "2rem",
							maxWidth: "450px",
							width: "100%",
							border: "1px solid #333",
						}}
					>
						<h3 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#fff", marginBottom: "1rem" }}>
							Cancel Subscription?
						</h3>
						<p style={{ color: "#888", marginBottom: "1.5rem", lineHeight: 1.6 }}>
							You'll still have access to your {tierName} features until{" "}
							<strong style={{ color: "#c4a77d" }}>{formatDate(subscription.renewal_date)}</strong>. After that,
							you'll be downgraded to the free plan.
						</p>
						<div style={{ display: "flex", gap: "1rem" }}>
							<button
								onClick={() => setShowCancelModal(false)}
								style={{
									flex: 1,
									background: "#333",
									color: "#fff",
									border: "none",
									padding: "12px 20px",
									borderRadius: "10px",
									fontSize: "0.95rem",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								Keep Subscription
							</button>
							<button
								onClick={handleCancelSubscription}
								style={{
									flex: 1,
									background: "#ef4444",
									color: "#fff",
									border: "none",
									padding: "12px 20px",
									borderRadius: "10px",
									fontSize: "0.95rem",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Change Card Modal */}
			{showChangeCardModal && (
				<div
					style={{
						position: "fixed",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						background: "rgba(0, 0, 0, 0.8)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 1000,
						padding: "1rem",
					}}
				>
					<div
						style={{
							background: "#1a1a1a",
							borderRadius: "16px",
							padding: "2rem",
							maxWidth: "500px",
							width: "100%",
							border: "1px solid #333",
						}}
					>
						<h3 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#fff", marginBottom: "1rem" }}>
							Change Payment Method
						</h3>
						<p style={{ color: "#888", marginBottom: "1.5rem" }}>Select a card for your subscription payments</p>

						<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
							{savedCards.map((card) => (
								<div
									key={card.id}
									onClick={() => setSelectedCardId(card.id)}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										background: selectedCardId === card.id ? "rgba(196, 167, 125, 0.1)" : "#0a0a0a",
										border: `2px solid ${selectedCardId === card.id ? "#c4a77d" : "#333"}`,
										borderRadius: "12px",
										padding: "1rem 1.25rem",
										cursor: "pointer",
										transition: "all 0.2s",
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
										<Image
											src={getCardTypeImage(card.card_type)}
											alt={card.card_type}
											width={40}
											height={26}
											style={{ borderRadius: "4px" }}
										/>
										<div>
											<div style={{ fontFamily: "'Courier New', monospace", color: "#fff" }}>
												•••• {card.card_last_four}
											</div>
											<div style={{ fontSize: "0.75rem", color: "#888" }}>Expires {card.card_expiry}</div>
										</div>
									</div>
									{selectedCardId === card.id && (
										<span style={{ color: "#c4a77d", fontSize: "1.25rem" }}>✓</span>
									)}
								</div>
							))}
						</div>

						<div style={{ display: "flex", gap: "1rem" }}>
							<button
								onClick={() => setShowChangeCardModal(false)}
								style={{
									flex: 1,
									background: "#333",
									color: "#fff",
									border: "none",
									padding: "12px 20px",
									borderRadius: "10px",
									fontSize: "0.95rem",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								Cancel
							</button>
							<button
								onClick={handleUpdatePaymentMethod}
								disabled={updatingCard}
								style={{
									flex: 1,
									background: "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)",
									color: "#000",
									border: "none",
									padding: "12px 20px",
									borderRadius: "10px",
									fontSize: "0.95rem",
									fontWeight: 600,
									cursor: updatingCard ? "not-allowed" : "pointer",
									opacity: updatingCard ? 0.7 : 1,
								}}
							>
								{updatingCard ? "Updating..." : "Update"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
