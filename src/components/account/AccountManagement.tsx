"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/components/NotificationsProvider";
import AccountIconGenerator from "@/components/AccountIconGenerator";
import Image from "next/image";
import { coffeeCollections } from "@/data/coffee";
import { machineCollections } from "@/data/machines";

// Import section components
import {
	ProfileSection,
	MemberStatusSection,
	SubscriptionSection,
	MachinesSection,
	PaymentsSection,
	ChatHistorySection,
	RepairPopup,
	MaintenancePopup,
} from "./sections";

// Import shared types and utilities
import {
	AccountData,
	ChatHistory,
	SubscriptionTier,
	SavedCard,
	Order,
	Subscription,
	UserMachine,
	CapsuleStats,
	ConsumptionHistory,
	RepairType,
	Repair,
	API_BASE,
	REPAIR_COSTS,
	TIER_BENEFITS,
	TIER_COLORS,
	TIER_THRESHOLDS,
	getIconUrl,
	getAuthToken,
	getCardTypeImage,
	calculateRepairCost,
	gradientTextStyle,
	formatDate,
} from "./sections/types";

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

export default function AccountManagement() {
	const router = useRouter();
	const { notify } = useNotifications();
	const [account, setAccount] = useState<AccountData | null>(null);
	const [accountId, setAccountId] = useState<number | null>(null);
	const [activeTab, setActiveTab] = useState<"profile" | "status" | "subscriptions" | "machines" | "payments" | "history">(
		"profile"
	);

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
	const [repairs, setRepairs] = useState<Repair[]>([]);
	const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
	const [loadingOrderItems, setLoadingOrderItems] = useState<Set<number>>(new Set());
	const [subscriptionData, setSubscriptionData] = useState<Subscription | null>(null);

	// Member Status State
	const [capsuleStats, setCapsuleStats] = useState<CapsuleStats | null>(null);
	const [consumptionHistory, setConsumptionHistory] = useState<ConsumptionHistory | null>(null);
	const [graphMounted, setGraphMounted] = useState(false);
	const [graphTheme, setGraphTheme] = useState<"classic" | "neon" | "minimal" | "gradient" | "monochrome">("classic");
	const [hoveredGraphPoint, setHoveredGraphPoint] = useState<{
		x: number;
		y: number;
		value: number;
		date: string;
		type: string;
		color: string;
	} | null>(null);

	useEffect(() => {
		const timer = setTimeout(() => setGraphMounted(true), 100);
		return () => clearTimeout(timer);
	}, []);
	const [isLoadingCapsuleStats, setIsLoadingCapsuleStats] = useState(false);

	// Machines State
	const [userMachines, setUserMachines] = useState<UserMachine[]>([]);
	const [isLoadingMachines, setIsLoadingMachines] = useState(false);
	const [maintenancePopup, setMaintenancePopup] = useState<{ open: boolean; machine: UserMachine | null }>({
		open: false,
		machine: null,
	});
	const [repairPopup, setRepairPopup] = useState<{ open: boolean; machine: UserMachine | null }>({
		open: false,
		machine: null,
	});
	const [selectedRepairType, setSelectedRepairType] = useState<RepairType>("general");
	const [selectedRepairPaymentId, setSelectedRepairPaymentId] = useState<number | null>(null);
	const [useWarrantyForRepair, setUseWarrantyForRepair] = useState<boolean>(true); // true = use warranty (free), false = pay

	// Portal mount state
	const [mounted, setMounted] = useState(false);

	// Spending State
	const [totalSpending, setTotalSpending] = useState<{
		orders: number;
		subscriptions: number;
		machines: number;
		products: number;
		total: number;
	}>({
		orders: 0,
		subscriptions: 0,
		machines: 0,
		products: 0,
		total: 0,
	});

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
						// Store account ID for graph theme saving
						if (data.user?.id) {
							setAccountId(data.user.id);
							// Fetch graph theme preference
							fetch(`${API_BASE}/api/accounts/preferences/${data.user.id}`)
								.then((res) => res.json())
								.then((prefData) => {
									if (prefData.graph_theme) {
										setGraphTheme(prefData.graph_theme);
									}
								})
								.catch((err) => console.error("Failed to load graph theme", err));
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
			// Load from server API (same as CoffeeRecommender)
			fetch("/api/chat/save")
				.then((res) => res.json())
				.then((data) => {
					if (data.history && Array.isArray(data.history)) {
						setChatHistory(data.history);
					}
				})
				.catch((e) => {
					console.error("Failed to load chat history", e);
				})
				.finally(() => {
					setIsLoadingHistory(false);
				});
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

			// Load repairs history from Express API
			fetch(`${API_BASE}/api/repairs`, {
				headers: { Authorization: `Bearer ${token}` },
			})
				.then((res) => res.json())
				.then((data) => {
					console.log("Repairs API response:", data);
					if (data.repairs && Array.isArray(data.repairs)) {
						setRepairs(data.repairs);
					}
				})
				.catch((err) => console.error("Failed to load repairs", err));
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

		if (activeTab === "machines") {
			setIsLoadingMachines(true);
			// Load machines from orders (filter by product_type = 'machine')
			fetch(`${API_BASE}/api/orders/machines`, {
				headers: { Authorization: `Bearer ${token}` },
			})
				.then((res) => res.json())
				.then((data) => {
					if (data.machines && Array.isArray(data.machines)) {
						setUserMachines(data.machines);
					}
				})
				.catch((err) => {
					console.error("Failed to load machines", err);
					// Fallback: extract machines from orders
					fetch(`${API_BASE}/api/orders`, {
						headers: { Authorization: `Bearer ${token}` },
					})
						.then((res) => res.json())
						.then((ordersData) => {
							if (ordersData.orders && Array.isArray(ordersData.orders)) {
								const machines: UserMachine[] = [];
								ordersData.orders.forEach((order: Order) => {
									if (order.items) {
										order.items.forEach((item) => {
											// Skip service items (repairs)
											if (item.product_type === "service") return;

											const lowerId = (item.product_id || "").toLowerCase();
											const lowerName = (item.product_name || "").toLowerCase();

											// Check if this is a forfait/pack
											const isForfait =
												lowerId.includes("pack-") ||
												lowerId.includes("forfait-") ||
												lowerName.includes("forfait") ||
												lowerName.includes("pack");

											// Check if this is a machine product
											const isMachine =
												lowerName.includes("machine") ||
												lowerId.includes("machine") ||
												machineCollections.some((c) =>
													c.groups.some((g) => g.products.some((p) => p.id === item.product_id))
												);

											if (isMachine || isForfait) {
												const purchaseDate = new Date(order.created_at);
												const warrantyEnd = new Date(purchaseDate);
												warrantyEnd.setFullYear(warrantyEnd.getFullYear() + 3);
												machines.push({
													id: item.id,
													order_id: order.id,
													order_number: order.order_number,
													product_type: item.product_type || "machine",
													product_id: item.product_id || "",
													product_name: item.product_name,
													product_image: item.product_image,
													unit_price: item.unit_price,
													quantity: item.quantity || 1,
													purchase_date: order.created_at,
													warranty_end_date: warrantyEnd.toISOString(),
													is_under_warranty: new Date() < warrantyEnd,
													is_forfait: isForfait,
												});
											}
										});
									}
								});
								setUserMachines(machines);
							}
						})
						.catch(() => {});
				})
				.finally(() => {
					setIsLoadingMachines(false);
				});
		}

		if (activeTab === "profile") {
			// Load total spending from orders API
			fetch(`${API_BASE}/api/orders/spending`, {
				headers: { Authorization: `Bearer ${token}` },
			})
				.then((res) => res.json())
				.then((data) => {
					if (data.spending) {
						setTotalSpending({
							orders: data.spending.orders || 0,
							subscriptions: data.spending.subscriptions || 0,
							machines: data.spending.machines || 0,
							products: data.spending.products || 0,
							total: data.spending.total || 0,
						});
					}
				})
				.catch((err) => {
					console.error("Failed to load spending", err);
					// Fallback: calculate from orders
					fetch(`${API_BASE}/api/orders`, {
						headers: { Authorization: `Bearer ${token}` },
					})
						.then((res) => res.json())
						.then((ordersData) => {
							let ordersTotal = 0;
							if (ordersData.orders && Array.isArray(ordersData.orders)) {
								ordersTotal = ordersData.orders.reduce(
									(sum: number, o: Order) => sum + (Number(o.total) || 0),
									0
								);
							}
							setTotalSpending({
								orders: ordersTotal,
								subscriptions: 0,
								machines: 0,
								products: 0,
								total: ordersTotal,
							});
						})
						.catch(() => {});
				});
		}

		if (activeTab === "status") {
			setIsLoadingCapsuleStats(true);
			Promise.all([
				fetch(`${API_BASE}/api/orders/capsule-stats`, {
					headers: { Authorization: `Bearer ${token}` },
				}).then((res) => res.json()),
				fetch(`${API_BASE}/api/orders/consumption-history`, {
					headers: { Authorization: `Bearer ${token}` },
				}).then((res) => res.json()),
			])
				.then(([statsData, historyData]) => {
					if (statsData.totalCapsules !== undefined) {
						setCapsuleStats(statsData);
					}
					if (historyData.capsules) {
						setConsumptionHistory(historyData);
					}
				})
				.catch((err) => {
					console.error("Failed to load stats", err);
				})
				.finally(() => {
					setIsLoadingCapsuleStats(false);
				});
		}
	}, [activeTab]);

	// Set mounted state for portal rendering
	useEffect(() => {
		setMounted(true);
		return () => setMounted(false);
	}, []);

	// Lock body scroll when modals are open
	useEffect(() => {
		const hasModalOpen = repairPopup.open || maintenancePopup.open;
		if (hasModalOpen) {
			document.body.classList.add("modal-open");
		} else {
			document.body.classList.remove("modal-open");
		}
		return () => {
			document.body.classList.remove("modal-open");
		};
	}, [repairPopup.open, maintenancePopup.open]);

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

	// Calculate repair cost based on machine price and repair type
	const calculateRepairCost = (machinePrice: number, repairType: RepairType, isWarranty: boolean): number => {
		if (isWarranty) return 0;
		const costRange = REPAIR_COSTS[repairType];
		const percentage = (costRange.min + costRange.max) / 2 / 100;
		return Math.round(machinePrice * percentage * 100) / 100;
	};

	// Handle repair request submission
	const handleRepairRequest = useCallback(async () => {
		if (!repairPopup.machine) return;

		const machine = repairPopup.machine;
		// Use warranty if machine is under warranty AND user chose to use it
		const isWarranty = machine.is_under_warranty && useWarrantyForRepair;
		const cost = calculateRepairCost(Number(machine.unit_price), selectedRepairType, isWarranty);

		try {
			const token = getAuthToken();
			if (!token) {
				notify("Please log in again.", 6000, "error", "account");
				return;
			}

			// Submit repair request
			const res = await fetch(`${API_BASE}/api/repairs`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					machine_id: machine.product_id,
					machine_name: machine.product_name,
					repair_type: selectedRepairType,
					is_warranty: isWarranty,
					estimated_cost: cost,
					order_id: machine.order_id,
					payment_card_id: isWarranty ? null : selectedRepairPaymentId,
				}),
			});

			if (res.ok) {
				const data = await res.json();
				const weatherMsg = data.isBadWeather ? " (Weather delay applied)" : "";

				notify(
					`Repair request submitted! Order #${data.orderNumber}. Est. duration: ${data.estimatedDuration} days${weatherMsg}`,
					8000,
					"success",
					"account"
				);
				setRepairPopup({ open: false, machine: null });
				setSelectedRepairPaymentId(null);
				setUseWarrantyForRepair(true);
			} else {
				const err = await res.json();
				notify(err.error || "Failed to submit repair request.", 6000, "error", "account");
			}
		} catch (e) {
			console.error("Repair request error", e);
			notify("An error occurred while submitting the request.", 6000, "error", "account");
		}
	}, [repairPopup.machine, selectedRepairType, selectedRepairPaymentId, useWarrantyForRepair, notify]);

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
				<button className={activeTab === "status" ? "active" : ""} onClick={() => setActiveTab("status")}>
					🏆 Member Status
				</button>
				<button className={activeTab === "subscriptions" ? "active" : ""} onClick={() => setActiveTab("subscriptions")}>
					🎫 Subscription
				</button>
				<button className={activeTab === "machines" ? "active" : ""} onClick={() => setActiveTab("machines")}>
					☕ Machines
				</button>
				<button className={activeTab === "payments" ? "active" : ""} onClick={() => setActiveTab("payments")}>
					💳 Payments
				</button>
				<button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>
					📜 Chat History
				</button>
			</div>

			<div className="account-content">
				{activeTab === "profile" && account && (
					<ProfileSection
						account={account}
						isEditing={isEditing}
						editFullName={editFullName}
						editEmail={editEmail}
						newPassword={newPassword}
						confirmPassword={confirmPassword}
						totalSpending={totalSpending}
						setIsEditing={setIsEditing}
						setEditFullName={setEditFullName}
						setEditEmail={setEditEmail}
						setNewPassword={setNewPassword}
						setConfirmPassword={setConfirmPassword}
						setEditIconDataUrl={setEditIconDataUrl}
						handleSaveProfile={handleSaveProfile}
						handleChangePassword={handleChangePassword}
					/>
				)}

				{activeTab === "status" && (
					<MemberStatusSection
						capsuleStats={capsuleStats}
						consumptionHistory={consumptionHistory}
						isLoadingCapsuleStats={isLoadingCapsuleStats}
						hoveredGraphPoint={hoveredGraphPoint}
						setHoveredGraphPoint={setHoveredGraphPoint}
						accountId={accountId || undefined}
						graphTheme={graphTheme}
					/>
				)}

				{activeTab === "subscriptions" && (
					<SubscriptionSection subscription={subscription} subscriptionData={subscriptionData} />
				)}

				{activeTab === "machines" && (
					<MachinesSection
						userMachines={userMachines}
						isLoadingMachines={isLoadingMachines}
						setMaintenancePopup={setMaintenancePopup}
						setRepairPopup={setRepairPopup}
						setSelectedRepairType={setSelectedRepairType}
						getProductImage={getProductImage}
					/>
				)}

				{activeTab === "payments" && (
					<PaymentsSection
						savedCards={savedCards}
						orders={orders}
						repairs={repairs}
						expandedOrders={expandedOrders}
						loadingOrderItems={loadingOrderItems}
						toggleOrderExpand={toggleOrderExpand}
						handleDeleteCard={handleDeleteCard}
						getProductImage={getProductImage}
					/>
				)}

				{activeTab === "history" && <ChatHistorySection chatHistory={chatHistory} isLoadingHistory={isLoadingHistory} />}
			</div>

			{/* Maintenance Popup Modal */}
			{mounted && (
				<MaintenancePopup
					isOpen={maintenancePopup.open}
					machine={maintenancePopup.machine}
					onClose={() => setMaintenancePopup({ open: false, machine: null })}
				/>
			)}

			{/* Repair Request Modal */}
			{mounted && (
				<RepairPopup
					isOpen={repairPopup.open}
					machine={repairPopup.machine}
					selectedRepairType={selectedRepairType}
					selectedRepairPaymentId={selectedRepairPaymentId}
					useWarrantyForRepair={useWarrantyForRepair}
					savedCards={savedCards}
					onClose={() => setRepairPopup({ open: false, machine: null })}
					onSelectRepairType={setSelectedRepairType}
					onSelectPaymentId={setSelectedRepairPaymentId}
					onToggleWarranty={setUseWarrantyForRepair}
					onSubmit={handleRepairRequest}
					notify={notify}
				/>
			)}
		</main>
	);
}
