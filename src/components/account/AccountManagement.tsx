"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/components/NotificationsProvider";
import AccountIconGenerator from "@/components/AccountIconGenerator";
import Image from "next/image";
import { coffeeCollections } from "@/data/coffee";
import { machineCollections } from "@/data/machines";

// API base URL - use Express API
const API_BASE = "http://localhost:4000";

type AccountData = {
	full_name: string | null;
	username: string;
	email: string;
	icon: string | null;
};

type Message = { role: "user" | "assistant"; content: string; products?: any[] };
type ChatHistory = {
	id: string;
	timestamp: number;
	messages: Message[];
	preview: string;
	model: "tanka" | "villanelle" | "ode";
	category: "coffee" | "chemistry" | "general";
};

type SubscriptionTier = "none" | "free" | "basic" | "plus" | "pro" | "max" | "ultimate";

type SavedCard = {
	id: number;
	card_holder: string;
	card_type: string;
	card_last_four: string;
	card_expiry: string;
	is_default: boolean;
	created_at: string;
};

type OrderItem = {
	id: number;
	product_id?: string;
	product_name: string;
	product_image: string | null;
	quantity: number;
	unit_price: number;
	total_price: number;
};

type Order = {
	id: number;
	order_number: string;
	status: string;
	subtotal: number;
	shipping_cost: number;
	tax: number;
	total: number;
	payment_method: string;
	created_at: string;
	items?: OrderItem[];
	item_count?: number;
	weather_condition?: "clear" | "rain" | "snow" | "normal";
	estimated_delivery?: string;
	expected_delivery_date?: string;
};

type Subscription = {
	id?: number;
	tier: string;
	billing_cycle: "monthly" | "annual" | null;
	price_ron: number;
	start_date: string | null;
	renewal_date: string | null;
	is_active: boolean;
	auto_renew: boolean;
	card?: {
		id: number;
		last_four: string;
		type: string;
	} | null;
};

// Helper to get icon URL from stored value
const getIconUrl = (icon: string | null) => {
	if (!icon) return null;
	if (icon.startsWith("/") || icon.startsWith("http")) {
		if (icon.startsWith("/api/icons/")) {
			return icon.replace("/api/icons/", "/images/icons/");
		}
		return icon;
	}
	return `/images/icons/${icon}`;
};

// Helper to get card type image
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

// Helper function to get product image from data
function getProductImage(productId: string): string | undefined {
	// Search in coffee collections
	for (const collection of coffeeCollections) {
		for (const group of collection.groups) {
			for (const product of group.products) {
				if (product.id === productId) {
					return product.image;
				}
			}
		}
	}

	// Search in machine collections
	for (const collection of machineCollections) {
		for (const group of collection.groups) {
			for (const product of group.products) {
				if (product.id === productId) {
					return product.image;
				}
			}
		}
	}

	return undefined;
}

// Helper to safely parse date
const formatDate = (dateString: string | number) => {
	try {
		const date = new Date(dateString);
		if (isNaN(date.getTime())) return "Date unavailable";
		return date.toLocaleDateString("en-US", {
			weekday: "short",
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	} catch (e) {
		return "Date unavailable";
	}
};

// Helper to get auth token
const getAuthToken = (): string | null => {
	if (typeof window === "undefined") return null;
	try {
		const session = sessionStorage.getItem("account_session");
		if (session) {
			const { token } = JSON.parse(session);
			return token || null;
		}
	} catch {
		return null;
	}
	return null;
};

export default function AccountManagement() {
	const router = useRouter();
	const { notify } = useNotifications();
	const [account, setAccount] = useState<AccountData | null>(null);
	const [activeTab, setActiveTab] = useState<"profile" | "subscriptions" | "payments" | "history">("profile");

	// Profile State
	const [isEditing, setIsEditing] = useState(false);
	const [editFullName, setEditFullName] = useState("");
	const [editEmail, setEditEmail] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [editIconDataUrl, setEditIconDataUrl] = useState<string | null>(null);

	// Data State
	const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
	const [subscription, setSubscription] = useState<SubscriptionTier>("free");
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
	const [orders, setOrders] = useState<Order[]>([]);
	const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
	const [loadingOrderItems, setLoadingOrderItems] = useState<Set<number>>(new Set());
	const [subscriptionData, setSubscriptionData] = useState<Subscription | null>(null);

	const gradientTextStyle = {
		background: "linear-gradient(135deg, rgb(196, 167, 125) 0%, rgb(166, 124, 82) 100%)",
		WebkitBackgroundClip: "text",
		WebkitTextFillColor: "transparent",
		backgroundClip: "text",
		color: "transparent",
		display: "inline-block",
	};

	// Load account from sessionStorage on mount
	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			const accountJson = sessionStorage.getItem("account_session");
			if (accountJson) {
				const accountData = JSON.parse(accountJson) as AccountData & { token?: string };
				setAccount({
					full_name: accountData.full_name,
					username: accountData.username,
					email: accountData.email,
					icon: accountData.icon,
				});
				setEditFullName(accountData.full_name || "");
				setEditEmail(accountData.email);
			}

			// Fetch subscription from API
			const token = getAuthToken();
			if (token) {
				fetch(`${API_BASE}/api/auth/me`, {
					headers: { Authorization: `Bearer ${token}` },
				})
					.then((res) => res.json())
					.then((data) => {
						if (data.user?.subscription) {
							setSubscription(data.user.subscription.toLowerCase() as SubscriptionTier);
						}
					})
					.catch((err) => console.error("Failed to load subscription", err));
			}
		} catch (e) {
			console.error("Failed to load account", e);
		}
	}, []);

	// Load data when tab changes
	useEffect(() => {
		const token = getAuthToken();
		if (!token) return;

		if (activeTab === "history") {
			setIsLoadingHistory(true);
			// Load from local storage
			try {
				const savedHistory = localStorage.getItem("chat_history");
				if (savedHistory) {
					const parsed = JSON.parse(savedHistory);
					if (Array.isArray(parsed)) {
						setChatHistory(parsed);
					}
				}
			} catch (e) {
				console.error("Failed to load chat history", e);
			}
			setIsLoadingHistory(false);
		}

		if (activeTab === "payments") {
			// Load saved cards from Express API
			fetch(`${API_BASE}/api/cards`, {
				headers: { Authorization: `Bearer ${token}` },
			})
				.then((res) => res.json())
				.then((data) => {
					console.log("Cards API response:", data);
					if (data.cards && Array.isArray(data.cards)) {
						setSavedCards(data.cards);
					}
				})
				.catch((err) => console.error("Failed to load cards", err));

			// Load orders from Express API
			fetch(`${API_BASE}/api/orders`, {
				headers: { Authorization: `Bearer ${token}` },
			})
				.then((res) => res.json())
				.then((data) => {
					console.log("Orders API response:", data);
					if (data.orders && Array.isArray(data.orders)) {
						setOrders(data.orders);
					}
				})
				.catch((err) => console.error("Failed to load orders", err));
		}

		if (activeTab === "subscriptions") {
			// Load subscription details from API
			fetch(`${API_BASE}/api/subscriptions`, {
				headers: { Authorization: `Bearer ${token}` },
			})
				.then((res) => res.json())
				.then((data) => {
					if (data.subscription) {
						setSubscriptionData(data.subscription);
						setSubscription(data.subscription.tier as SubscriptionTier);
					}
				})
				.catch((err) => console.error("Failed to load subscription", err));
		}
	}, [activeTab]);

	// Toggle order expansion and load items if needed
	const toggleOrderExpand = useCallback(
		async (orderId: number) => {
			const isExpanded = expandedOrders.has(orderId);

			if (isExpanded) {
				setExpandedOrders((prev) => {
					const next = new Set(prev);
					next.delete(orderId);
					return next;
				});
			} else {
				const order = orders.find((o) => o.id === orderId);
				if (order && !order.items) {
					const token = getAuthToken();
					if (token) {
						setLoadingOrderItems((prev) => new Set(prev).add(orderId));
						try {
							const res = await fetch(`${API_BASE}/api/orders/${orderId}`, {
								headers: { Authorization: `Bearer ${token}` },
							});
							const data = await res.json();
							if (data.order?.items) {
								setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, items: data.order.items } : o)));
							}
						} catch (e) {
							console.error("Failed to load order items", e);
						} finally {
							setLoadingOrderItems((prev) => {
								const next = new Set(prev);
								next.delete(orderId);
								return next;
							});
						}
					}
				}
				setExpandedOrders((prev) => new Set(prev).add(orderId));
			}
		},
		[expandedOrders, orders]
	);

	const handleSignOut = useCallback(() => {
		if (typeof window === "undefined") return;
		sessionStorage.removeItem("account_session");
		notify("You have been signed out.", 6000, "success", "account");
		window.location.reload(); // Reload to reset state in parent
	}, [notify]);

	const handleSaveProfile = useCallback(async () => {
		if (!account) return;

		const fullName = editFullName.trim();
		const email = editEmail.trim();

		if (!fullName || !email) {
			notify("Full name and email are required.", 6000, "error", "account");
			return;
		}

		if (!email.includes("@")) {
			notify("Invalid email address.", 6000, "error", "account");
			return;
		}

		try {
			const session = sessionStorage.getItem("account_session");
			if (!session) {
				notify("Please log in again.", 6000, "error", "account");
				return;
			}

			const { token } = JSON.parse(session);
			const res = await fetch("http://localhost:4000/api/accounts/update", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					full_name: fullName,
					email,
					icon: editIconDataUrl || account.icon,
				}),
			});

			if (res.ok) {
				const updatedAccount: AccountData = {
					...account,
					full_name: fullName,
					email,
					icon: editIconDataUrl || account.icon,
				};
				// Update sessionStorage with new data
				const currentSession = JSON.parse(sessionStorage.getItem("account_session") || "{}");
				sessionStorage.setItem("account_session", JSON.stringify({ ...currentSession, ...updatedAccount }));
				setAccount(updatedAccount);
				setIsEditing(false);
				notify("Profile updated successfully!", 6000, "success", "account");
			} else {
				notify("Failed to update profile.", 6000, "error", "account");
			}
		} catch (e) {
			notify("Failed to update profile.", 6000, "error", "account");
		}
	}, [account, editFullName, editEmail, editIconDataUrl, notify]);

	const handleChangePassword = useCallback(async () => {
		if (!newPassword || !confirmPassword) {
			notify("Please enter a password.", 6000, "error", "account");
			return;
		}
		if (newPassword !== confirmPassword) {
			notify("Passwords do not match.", 6000, "error", "account");
			return;
		}
		if (newPassword.length < 8) {
			notify("Password must be at least 8 characters.", 6000, "error", "account");
			return;
		}
		notify("Password updated successfully.", 6000, "success", "account");
		setNewPassword("");
		setConfirmPassword("");
	}, [newPassword, confirmPassword, notify]);

	const handleDeleteCard = useCallback(
		async (id: number) => {
			if (!confirm("Are you sure you want to remove this card?")) return;
			const token = getAuthToken();
			if (!token) {
				notify("Please log in again.", 6000, "error", "account");
				return;
			}
			try {
				const res = await fetch(`${API_BASE}/api/cards/${id}`, {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				});
				if (res.ok) {
					setSavedCards((prev) => prev.filter((c) => c.id !== id));
					notify("Card removed successfully.", 3000, "success", "account");
				} else {
					notify("Failed to remove card.", 3000, "error", "account");
				}
			} catch (e) {
				notify("Error removing card.", 3000, "error", "account");
			}
		},
		[notify]
	);

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

	if (!account) return null;

	return (
		<main className="account-management fade-in">
			<div className="account-header">
				<div className="account-avatar">
					{account.icon ? (
						<img src={getIconUrl(account.icon) || account.icon} alt="Profile" />
					) : (
						<div className="avatar-placeholder">{account.username[0].toUpperCase()}</div>
					)}
				</div>
				<div className="account-info">
					<h1>{account.full_name || account.username}</h1>
					<p>{account.email}</p>
					<div className="account-badges">
						<span className="badge">
							{subscription === "none" || subscription === "free"
								? "Free Plan"
								: `${subscription.charAt(0).toUpperCase() + subscription.slice(1)} Plan`}
						</span>
						<span className="badge outline">Member since 2025</span>
					</div>
				</div>
				<button className="sign-out-btn" onClick={handleSignOut}>
					Sign Out
				</button>
			</div>

			<div className="account-tabs">
				<button className={activeTab === "profile" ? "active" : ""} onClick={() => setActiveTab("profile")}>
					👤 Profile
				</button>
				<button className={activeTab === "subscriptions" ? "active" : ""} onClick={() => setActiveTab("subscriptions")}>
					🎫 Subscription
				</button>
				<button className={activeTab === "payments" ? "active" : ""} onClick={() => setActiveTab("payments")}>
					💳 Payments
				</button>
				<button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>
					📜 Chat History
				</button>
			</div>

			<div className="account-content">
				{activeTab === "profile" && (
					<div className="tab-pane fade-in">
						<div className="card">
							<div className="card-header">
								<h2>Personal Information</h2>
								{!isEditing && <button onClick={() => setIsEditing(true)}>Edit</button>}
							</div>
							{isEditing ? (
								<div className="form-grid">
									<div className="form-group">
										<label>Full Name</label>
										<input value={editFullName} onChange={(e) => setEditFullName(e.target.value)} />
									</div>
									<div className="form-group">
										<label>Email</label>
										<input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
									</div>
									<div className="form-group full-width">
										<label>Profile Icon</label>
										<AccountIconGenerator username={account.username} onChange={setEditIconDataUrl} />
									</div>
									<div className="form-actions">
										<button className="btn-primary" onClick={handleSaveProfile}>
											Save Changes
										</button>
										<button className="btn-secondary" onClick={() => setIsEditing(false)}>
											Cancel
										</button>
									</div>
								</div>
							) : (
								<div className="info-grid">
									<div className="info-item">
										<label>Username</label>
										<p>{account.username}</p>
									</div>
									<div className="info-item">
										<label>Full Name</label>
										<p>{account.full_name || "Not set"}</p>
									</div>
									<div className="info-item">
										<label>Email</label>
										<p>{account.email}</p>
									</div>
								</div>
							)}
						</div>

						<div className="card">
							<div className="card-header">
								<h2>Security</h2>
							</div>
							<div className="form-grid">
								<div className="form-group">
									<label>New Password</label>
									<input
										type="password"
										value={newPassword}
										onChange={(e) => setNewPassword(e.target.value)}
										placeholder="••••••••"
									/>
								</div>
								<div className="form-group">
									<label>Confirm Password</label>
									<input
										type="password"
										value={confirmPassword}
										onChange={(e) => setConfirmPassword(e.target.value)}
										placeholder="••••••••"
									/>
								</div>
								<div className="form-actions">
									<button className="btn-primary" onClick={handleChangePassword}>
										Update Password
									</button>
								</div>
							</div>
						</div>
					</div>
				)}

				{activeTab === "subscriptions" && (
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
									<li>
										{subscription !== "none" && subscription !== "free" ? "✅" : "❌"} Access to Kafelot
										Villanelle
									</li>
									<li>{subscription === "ultimate" ? "✅" : "❌"} Access to Kafelot Ode</li>
									<li>{subscription === "ultimate" ? "✅" : "❌"} Chemistry Mode & Visualizations</li>
								</ul>
							</div>
							<div className="sub-actions">
								<button
									className="btn-primary"
									onClick={() =>
										router.push(
											subscription === "none" || subscription === "free"
												? "/subscription"
												: "/manage-subscription"
										)
									}
								>
									{subscription === "none" || subscription === "free" ? "Upgrade Plan" : "Manage Subscription"}
								</button>
							</div>
						</div>
					</div>
				)}

				{activeTab === "payments" && (
					<div className="tab-pane fade-in">
						{/* Saved Cards Section */}
						<div className="card" style={{ marginBottom: "2rem" }}>
							<h2>Saved Cards</h2>
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
											// onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
											// onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
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
														{card.is_default && (
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
														)}
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

						{/* Order History Section with Expandable Items */}
						<div className="card">
							<h2>Order History</h2>
							{orders.length === 0 ? (
								<p className="empty-state">No orders found.</p>
							) : (
								<div className="orders-list" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
									{orders.map((order) => {
										// Ensure numeric values
										const total = Number(order.total) || 0;
										// Get shipping from database
										const shippingCost = Number(order.shipping_cost) || 0;
										// VAT calculation: 21% of Total (VAT is included in price)
										const tax = Math.round(total * 0.21 * 100) / 100;
										const subtotal = total - tax;
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
													boxShadow: isExpanded
														? "0 8px 24px rgba(0,0,0,0.5)"
														: "0 2px 4px rgba(0,0,0,0.2)",
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
																fontSize: "1.5rem",
															}}
														>
															{order.status === "delivered"
																? "📦"
																: order.status === "shipped"
																? "🚚"
																: "🛍️"}
														</div>

														<div>
															<div
																style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
															>
																<span
																	style={{
																		fontWeight: 700,
																		fontSize: "1.1rem",
																		...gradientTextStyle,
																	}}
																>
																	Order #
																	{order.order_number.split("-")[1] || order.order_number}
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
																<span style={{ color: "#e5e5e5" }}>
																	📅 {formatDate(order.created_at)}
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
																			}}
																		>
																			{order.weather_condition === "snow"
																				? "❄️"
																				: order.weather_condition === "rain"
																				? "🌧️"
																				: "📦"}{" "}
																			{order.estimated_delivery}
																		</span>
																	</>
																)}
															</div>
														</div>
													</div>

													<div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
														<div style={{ textAlign: "right" }}>
															<div
																style={{
																	fontSize: "0.85rem",
																	color: "#aaa",
																	marginBottom: "2px",
																}}
															>
																Total Amount
															</div>
															<div
																style={{
																	fontWeight: 700,
																	fontSize: "1.25rem",
																	...gradientTextStyle,
																}}
															>
																{total.toFixed(2)}{" "}
																<span style={{ fontSize: "0.9rem", fontWeight: 500 }}>RON</span>
															</div>
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
															<span style={{ fontSize: "0.8rem", color: "#aaa" }}>▼</span>
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
																	{order.items.map((item, index) => {
																		const unitPrice = Number(item.unit_price) || 0;
																		const totalPrice = Number(item.total_price) || 0;
																		const img =
																			item.product_image ||
																			(item.product_id
																				? getProductImage(item.product_id)
																				: undefined);

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
																						<span style={{ fontSize: "2rem" }}>
																							☕
																						</span>
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
																					<div
																						style={{
																							fontSize: "0.9rem",
																							color: "#aaa",
																						}}
																					>
																						Quantity:{" "}
																						<strong style={{ color: "#ccc" }}>
																							{item.quantity}
																						</strong>
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
																						{unitPrice.toFixed(2)} RON / unit
																					</div>
																					<div
																						style={{
																							fontWeight: 700,
																							fontSize: "1.1rem",
																							...gradientTextStyle,
																						}}
																					>
																						{totalPrice.toFixed(2)} RON
																					</div>
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
																	<div
																		style={{
																			display: "flex",
																			justifyContent: "flex-end",
																		}}
																	>
																		<div style={{ width: "100%", maxWidth: "300px" }}>
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
																				<span>{subtotal.toFixed(2)} RON</span>
																			</div>
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
																						<span style={{ color: "#10b981" }}>
																							Free
																						</span>
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
																				<span>Tax (VAT 21%)</span>
																				<span>{tax.toFixed(2)} RON</span>
																			</div>
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
																				<span>{total.toFixed(2)} RON</span>
																			</div>

																			{/* Expected Delivery Date - All in one line */}
																			{(order.expected_delivery_date ||
																				order.estimated_delivery) && (
																				<div
																					style={{
																						display: "flex",
																						justifyContent: "space-between",
																						alignItems: "center",
																						marginTop: "1rem",
																						paddingTop: "1rem",
																						borderTop: "1px solid #333",
																						fontSize: "0.95rem",
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
																						<span style={{ fontSize: "1.1rem" }}>
																							{order.weather_condition === "snow"
																								? "❄️"
																								: order.weather_condition ===
																								  "rain"
																								? "🌧️"
																								: "📦"}
																						</span>
																						Expected Delivery
																					</span>
																					<span
																						style={{
																							fontWeight: 600,
																							color:
																								order.status === "delivered"
																									? "#10b981"
																									: "#c4a77d",
																						}}
																					>
																						{order.status === "delivered"
																							? "✓ Delivered"
																							: order.expected_delivery_date
																							? formatDate(
																									order.expected_delivery_date
																							  )
																							: order.estimated_delivery}
																					</span>
																				</div>
																			)}
																		</div>
																	</div>
																</div>
															</div>
														) : (
															<div
																style={{
																	textAlign: "center",
																	padding: "2rem",
																	color: "#888",
																}}
															>
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
						</div>
					</div>
				)}

				{activeTab === "history" && (
					<div className="tab-pane fade-in">
						<div className="card">
							<h2>Chat History</h2>
							{isLoadingHistory ? (
								<p>Loading history...</p>
							) : chatHistory.length === 0 ? (
								<p className="empty-state">No chat history found.</p>
							) : (
								<div className="history-grid">
									{chatHistory.map((chat) => (
										<div key={chat.id} className="history-card">
											<div className="history-icon">
												{chat.category === "chemistry" ? "🧪" : chat.category === "coffee" ? "☕" : "🤖"}
											</div>
											<div className="history-content">
												<h4>{chat.preview}</h4>
												<div className="history-meta">
													<span>{new Date(chat.timestamp).toLocaleDateString()}</span>
													<span className="model-tag">{chat.model}</span>
												</div>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</main>
	);
}
