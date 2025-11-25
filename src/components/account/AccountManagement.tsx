"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/components/NotificationsProvider";
import AccountIconGenerator from "@/components/AccountIconGenerator";
import Image from "next/image";

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

type SubscriptionTier = "none" | "basic" | "plus" | "pro" | "max" | "ultimate";

// Helper to get icon URL from stored value
const getIconUrl = (icon: string | null) => {
	if (!icon) return null;
	// If it's already a full path, use it
	if (icon.startsWith("/") || icon.startsWith("http")) {
		// Convert old /api/icons/ paths
		if (icon.startsWith("/api/icons/")) {
			return icon.replace("/api/icons/", "/images/icons/");
		}
		return icon;
	}
	// Otherwise it's just a filename, construct the path
	return `/images/icons/${icon}`;
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
	const [passwordVisible, setPasswordVisible] = useState(false);

	// Data State
	const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
	const [subscription, setSubscription] = useState<SubscriptionTier>("none");
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const [savedCards, setSavedCards] = useState<any[]>([]);
	const [orders, setOrders] = useState<any[]>([]);

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
			const session = sessionStorage.getItem("account_session");
			if (session) {
				const { token } = JSON.parse(session);
				if (token) {
					fetch("http://localhost:4000/api/auth/me", {
						headers: { Authorization: `Bearer ${token}` },
					})
						.then((res) => res.json())
						.then((data) => {
							if (data.user?.subscription_name) {
								setSubscription(data.user.subscription_name.toLowerCase() as SubscriptionTier);
							}
						})
						.catch((err) => console.error("Failed to load subscription", err));
				}
			}
		} catch (e) {
			console.error("Failed to load account", e);
		}
	}, []);

	// Load chat history when tab changes
	useEffect(() => {
		if (activeTab === "history") {
			setIsLoadingHistory(true);
			fetch("/api/chat/save")
				.then((res) => res.json())
				.then((data) => {
					if (data.history && Array.isArray(data.history)) {
						setChatHistory(data.history);
					}
				})
				.catch((err) => console.error("Failed to load history", err))
				.finally(() => setIsLoadingHistory(false));
		}
		if (activeTab === "payments") {
			fetch("/api/user/cards")
				.then((res) => res.json())
				.then((data) => {
					if (Array.isArray(data)) {
						setSavedCards(data);
					}
				})
				.catch((err) => console.error("Failed to load cards", err));

			if (account) {
				fetch(`/api/order?username=${account.username}`)
					.then((res) => res.json())
					.then((data) => {
						if (Array.isArray(data)) {
							setOrders(data);
						}
					})
					.catch((err) => console.error("Failed to load orders", err));
			}
		}
	}, [activeTab, account]);

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

	const handleChangePassword = useCallback(() => {
		if (!newPassword || !confirmPassword) {
			notify("Please enter a password.", 6000, "error", "account");
			return;
		}
		if (newPassword !== confirmPassword) {
			notify("Passwords do not match.", 6000, "error", "account");
			return;
		}
		notify("Password updated successfully (simulated).", 6000, "success", "account");
		setNewPassword("");
		setConfirmPassword("");
	}, [newPassword, confirmPassword, notify]);

	const handleDeleteCard = useCallback(
		async (id: string) => {
			if (!confirm("Are you sure you want to remove this card?")) return;
			try {
				const res = await fetch(`/api/user/cards?id=${id}`, { method: "DELETE" });
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
						<span className="badge">{subscription === "none" ? "Free Plan" : `${subscription} Plan`}</span>
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
									<p className="sub-status">Active</p>
								</div>
								<div className="sub-price">
									{subscription === "none" ? "Free" : subscription === "ultimate" ? "$29.99" : "$9.99"}
									<span>/month</span>
								</div>
							</div>
							<div className="sub-details">
								<h3>
									{subscription === "none"
										? "Basic Access"
										: `${subscription.charAt(0).toUpperCase() + subscription.slice(1)} Tier`}
								</h3>
								<ul>
									<li>✅ Access to Kafelot Tanka</li>
									<li>{subscription !== "none" ? "✅" : "❌"} Access to Kafelot Villanelle</li>
									<li>{subscription === "ultimate" ? "✅" : "❌"} Access to Kafelot Ode</li>
									<li>{subscription === "ultimate" ? "✅" : "❌"} Chemistry Mode & Visualizations</li>
								</ul>
							</div>
							<div className="sub-actions">
								<button className="btn-primary" onClick={() => router.push("/subscription")}>
									{subscription === "none" ? "Upgrade Plan" : "Manage Subscription"}
								</button>
							</div>
						</div>
					</div>
				)}

				{activeTab === "payments" && (
					<div className="tab-pane fade-in">
						<div className="card" style={{ marginBottom: "2rem" }}>
							<h2>Saved Cards</h2>
							{savedCards.length === 0 ? (
								<p>No saved cards found.</p>
							) : (
								<div
									className="saved-cards-grid"
									style={{
										display: "grid",
										gap: "1rem",
										gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
									}}
								>
									{savedCards.map((card) => (
										<div
											key={card.id}
											className="saved-card-item"
											style={{
												border: "1px solid #eee",
												padding: "1rem",
												borderRadius: "8px",
												position: "relative",
											}}
										>
											<div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>{card.cardType}</div>
											<div style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
												•••• •••• •••• {card.last4}
											</div>
											<div style={{ color: "#666", fontSize: "0.9rem" }}>Expires: {card.expiry}</div>
											<button
												onClick={() => handleDeleteCard(card.id)}
												style={{
													position: "absolute",
													top: "1rem",
													right: "1rem",
													background: "none",
													border: "none",
													color: "#ff4444",
													cursor: "pointer",
													fontSize: "0.9rem",
												}}
											>
												Remove
											</button>
										</div>
									))}
								</div>
							)}
						</div>

						<div className="card">
							<h2>Payment History</h2>
							<div className="table-responsive">
								<table className="data-table">
									<thead>
										<tr>
											<th>Date</th>
											<th>Description</th>
											<th>Amount</th>
											<th>Status</th>
										</tr>
									</thead>
									<tbody>
										{orders.length === 0 ? (
											<tr>
												<td colSpan={4} style={{ textAlign: "center", padding: "2rem" }}>
													No orders found.
												</td>
											</tr>
										) : (
											orders.map((order) => (
												<tr key={order.id}>
													<td>{new Date(order.date).toLocaleDateString()}</td>
													<td>
														{order.items.length} items
														<br />
														<span style={{ fontSize: "0.8rem", color: "#666" }}>
															{order.items
																.map((i: any) => i.name)
																.join(", ")
																.slice(0, 50)}
															{order.items.length > 1 ? "..." : ""}
														</span>
													</td>
													<td>{order.total.toFixed(2)} RON</td>
													<td>
														<span className="status-pill success">{order.status}</span>
													</td>
												</tr>
											))
										)}
									</tbody>
								</table>
							</div>
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
