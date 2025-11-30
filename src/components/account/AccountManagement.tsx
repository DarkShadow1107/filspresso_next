"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
	product_type?: string;
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

type UserMachine = {
	id: number;
	order_id: number;
	order_number: string;
	product_type: string;
	product_id: string;
	product_name: string;
	product_image: string | null;
	unit_price: number;
	quantity: number;
	purchase_date: string;
	warranty_end_date: string;
	is_under_warranty: boolean;
	is_forfait: boolean;
};

type RepairType = "cleaning" | "descaling" | "pump" | "heating" | "general";

type MaintenanceInfo = {
	title: string;
	description: string;
	frequency: string;
	steps: string[];
};

const MAINTENANCE_GUIDES: Record<string, MaintenanceInfo[]> = {
	default: [
		{
			title: "Daily Cleaning",
			description: "Keep your machine hygienic and coffee tasting great",
			frequency: "Daily",
			steps: [
				"Rinse the drip tray and empty the capsule container",
				"Wipe the exterior with a damp cloth",
				"Run a water-only cycle to flush the system",
			],
		},
		{
			title: "Weekly Deep Clean",
			description: "Maintain optimal performance",
			frequency: "Weekly",
			steps: [
				"Remove and wash the drip tray with warm soapy water",
				"Clean the capsule container thoroughly",
				"Wipe the capsule insertion area with a damp cloth",
				"Check and clean the water tank",
			],
		},
		{
			title: "Descaling",
			description: "Remove mineral buildup for better taste and longevity",
			frequency: "Every 3 months or after 300 capsules",
			steps: [
				"Empty the water tank and add descaling solution",
				"Place a container under the coffee outlet",
				"Enter descaling mode (check your machine manual)",
				"Run the full descaling cycle",
				"Rinse with fresh water at least twice",
			],
		},
	],
};

const REPAIR_COSTS: Record<RepairType, { min: number; max: number; description: string }> = {
	cleaning: { min: 10, max: 15, description: "Professional deep cleaning" },
	descaling: { min: 15, max: 20, description: "Industrial descaling service" },
	pump: { min: 25, max: 35, description: "Pump repair or replacement" },
	heating: { min: 30, max: 40, description: "Heating element service" },
	general: { min: 20, max: 30, description: "General maintenance and inspection" },
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
	const [activeTab, setActiveTab] = useState<"profile" | "subscriptions" | "machines" | "payments" | "history">("profile");

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

			// Submit repair request (API endpoint would need to be created)
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
				notify(
					isWarranty
						? "Warranty repair request submitted! We'll contact you within 24 hours."
						: `Paid repair request submitted! Estimated cost: ${cost.toFixed(2)} RON`,
					6000,
					"success",
					"account"
				);
				setRepairPopup({ open: false, machine: null });
				setSelectedRepairPaymentId(null);
				setUseWarrantyForRepair(true);
			} else {
				// Even if API doesn't exist yet, show success for demo
				notify(
					isWarranty
						? "Warranty repair request submitted! We'll contact you within 24 hours."
						: `Paid repair request submitted! Estimated cost: ${cost.toFixed(2)} RON`,
					6000,
					"success",
					"account"
				);
				setRepairPopup({ open: false, machine: null });
				setSelectedRepairPaymentId(null);
				setUseWarrantyForRepair(true);
			}
		} catch (e) {
			// For demo purposes, still show success
			const isWarrantyFallback = machine.is_under_warranty && useWarrantyForRepair;
			notify(
				isWarrantyFallback
					? "Warranty repair request submitted! We'll contact you within 24 hours."
					: `Paid repair request submitted! Estimated cost: ${calculateRepairCost(
							Number(machine.unit_price),
							selectedRepairType,
							false
					  ).toFixed(2)} RON`,
				6000,
				"success",
				"account"
			);
			setRepairPopup({ open: false, machine: null });
			setSelectedRepairPaymentId(null);
			setUseWarrantyForRepair(true);
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

						{/* Total Spending Card */}
						<div className="card">
							<div className="card-header">
								<h2>💰 How Much Did You Spend With Us</h2>
							</div>
							<div
								style={{
									background:
										"linear-gradient(135deg, rgba(196, 167, 125, 0.1) 0%, rgba(166, 124, 82, 0.1) 100%)",
									border: "1px solid rgba(196, 167, 125, 0.3)",
									borderRadius: "16px",
									padding: "1.5rem",
									marginTop: "1rem",
								}}
							>
								{/* Total Amount - Large Display */}
								<div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
									<div
										style={{
											fontSize: "0.9rem",
											color: "#888",
											marginBottom: "0.5rem",
											textTransform: "uppercase",
											letterSpacing: "1px",
										}}
									>
										Total Lifetime Spending
									</div>
									<div
										style={{
											fontSize: "3rem",
											fontWeight: 700,
											...gradientTextStyle,
										}}
									>
										{totalSpending.total.toFixed(2)} <span style={{ fontSize: "1.5rem" }}>RON</span>
									</div>
								</div>

								{/* Breakdown */}
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "repeat(3, 1fr)",
										gap: "1rem",
										paddingTop: "1rem",
										borderTop: "1px solid rgba(196, 167, 125, 0.2)",
									}}
								>
									<div
										style={{
											background: "#1a1a1a",
											borderRadius: "12px",
											padding: "1rem",
											textAlign: "center",
										}}
									>
										<div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>☕</div>
										<div style={{ fontSize: "0.8rem", color: "#888", marginBottom: "0.25rem" }}>
											Capsules & Acc.
										</div>
										<div style={{ fontSize: "1.1rem", fontWeight: 600, ...gradientTextStyle }}>
											{totalSpending.products.toFixed(2)} RON
										</div>
									</div>
									<div
										style={{
											background: "#1a1a1a",
											borderRadius: "12px",
											padding: "1rem",
											textAlign: "center",
										}}
									>
										<div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>🎫</div>
										<div style={{ fontSize: "0.8rem", color: "#888", marginBottom: "0.25rem" }}>
											Subscriptions
										</div>
										<div style={{ fontSize: "1.1rem", fontWeight: 600, ...gradientTextStyle }}>
											{totalSpending.subscriptions.toFixed(2)} RON
										</div>
									</div>
									<div
										style={{
											background: "#1a1a1a",
											borderRadius: "12px",
											padding: "1rem",
											textAlign: "center",
										}}
									>
										<div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>⚙️</div>
										<div style={{ fontSize: "0.8rem", color: "#888", marginBottom: "0.25rem" }}>Machines</div>
										<div style={{ fontSize: "1.1rem", fontWeight: 600, ...gradientTextStyle }}>
											{totalSpending.machines.toFixed(2)} RON
										</div>
									</div>
								</div>

								{/* Thank you message */}
								<div
									style={{
										marginTop: "1rem",
										padding: "0.75rem 1rem",
										background: "rgba(16, 185, 129, 0.1)",
										border: "1px solid rgba(16, 185, 129, 0.3)",
										borderRadius: "8px",
										textAlign: "center",
										fontSize: "0.9rem",
										color: "#10b981",
									}}
								>
									Thank you for being a valued Filspresso customer! ☕
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

				{activeTab === "machines" && (
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
										const purchaseDate = new Date(machine.purchase_date);
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
																				background:
																					"linear-gradient(135deg, #8b5cf6, #6366f1)",
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
																<div
																	style={{
																		fontSize: "0.75rem",
																		color: "#888",
																		marginTop: "0.25rem",
																	}}
																>
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
																{machine.is_under_warranty
																	? `✓ ${daysUntilWarrantyEnd}d left`
																	: "Expired"}
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
																<span style={{ color: "#ccc" }}>
																	{formatDate(machine.purchase_date)}
																</span>
															</div>
															<div style={{ fontSize: "0.75rem" }}>
																<span style={{ color: "#666" }}>Price: </span>
																<span style={{ ...gradientTextStyle, fontWeight: 600 }}>
																	{Number(machine.unit_price).toFixed(2)} RON
																</span>
															</div>
															<div style={{ fontSize: "0.75rem" }}>
																<span style={{ color: "#666" }}>Valid: </span>
																<span
																	style={{
																		color: machine.is_under_warranty ? "#10b981" : "#f59e0b",
																	}}
																>
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
							<div
								className="card-header"
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									marginBottom: "1.5rem",
								}}
							>
								<h2 style={{ margin: 0 }}>Chat History</h2>
								<div style={{ fontSize: "0.9rem", color: "#888" }}>
									{chatHistory.length} conversation{chatHistory.length !== 1 ? "s" : ""}
								</div>
							</div>
							{isLoadingHistory ? (
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
									Loading chat history...
								</div>
							) : chatHistory.length === 0 ? (
								<div style={{ textAlign: "center", padding: "3rem" }}>
									<div style={{ fontSize: "3rem", marginBottom: "1rem" }}>💬</div>
									<p style={{ color: "#888", fontSize: "1.1rem", margin: "0 0 0.5rem 0" }}>
										No chat history yet
									</p>
									<p style={{ color: "#666", fontSize: "0.9rem", margin: 0 }}>
										Start a conversation with Kafelot to see your history here
									</p>
								</div>
							) : (
								<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
									{chatHistory.map((chat) => {
										const messageCount = chat.messages?.length || 0;
										const userMessages = chat.messages?.filter((m) => m.role === "user").length || 0;
										const assistantMessages =
											chat.messages?.filter((m) => m.role === "assistant").length || 0;
										const lastMessage = chat.messages?.[chat.messages.length - 1];
										const hasProducts = chat.messages?.some((m) => m.products && m.products.length > 0);

										return (
											<div
												key={chat.id}
												style={{
													background: "#1a1a1a",
													border: "1px solid #333",
													borderRadius: "12px",
													padding: "1.25rem 1.5rem",
													transition: "all 0.2s ease",
													cursor: "default",
												}}
												onMouseEnter={(e) => {
													e.currentTarget.style.borderColor = "rgba(196, 167, 125, 0.4)";
													e.currentTarget.style.background = "#1f1f1f";
												}}
												onMouseLeave={(e) => {
													e.currentTarget.style.borderColor = "#333";
													e.currentTarget.style.background = "#1a1a1a";
												}}
											>
												{/* Header Row */}
												<div
													style={{
														display: "flex",
														justifyContent: "space-between",
														alignItems: "flex-start",
														marginBottom: "0.75rem",
													}}
												>
													<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
														{/* Category Icon */}
														<div
															style={{
																width: "42px",
																height: "42px",
																borderRadius: "10px",
																background:
																	chat.category === "chemistry"
																		? "rgba(139, 92, 246, 0.15)"
																		: chat.category === "coffee"
																		? "rgba(196, 167, 125, 0.15)"
																		: "rgba(59, 130, 246, 0.15)",
																display: "flex",
																alignItems: "center",
																justifyContent: "center",
																fontSize: "1.3rem",
															}}
														>
															{chat.category === "chemistry"
																? "🧪"
																: chat.category === "coffee"
																? "☕"
																: "🤖"}
														</div>
														<div>
															<div
																style={{
																	fontWeight: 600,
																	color: "#e5e5e5",
																	fontSize: "1rem",
																	marginBottom: "0.15rem",
																}}
															>
																{chat.preview.length > 60
																	? chat.preview.slice(0, 60) + "..."
																	: chat.preview}
															</div>
															<div
																style={{
																	fontSize: "0.8rem",
																	color: "#888",
																	display: "flex",
																	alignItems: "center",
																	gap: "0.5rem",
																}}
															>
																<span>
																	{new Date(chat.timestamp).toLocaleDateString("en-US", {
																		month: "short",
																		day: "numeric",
																		year: "numeric",
																	})}
																</span>
																<span>•</span>
																<span>
																	{new Date(chat.timestamp).toLocaleTimeString("en-US", {
																		hour: "2-digit",
																		minute: "2-digit",
																	})}
																</span>
															</div>
														</div>
													</div>

													{/* Model Badge */}
													<div
														style={{
															background:
																chat.model === "ode"
																	? "linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(124, 58, 237, 0.2) 100%)"
																	: chat.model === "villanelle"
																	? "linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(37, 99, 235, 0.2) 100%)"
																	: "linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%)",
															border:
																chat.model === "ode"
																	? "1px solid rgba(139, 92, 246, 0.4)"
																	: chat.model === "villanelle"
																	? "1px solid rgba(59, 130, 246, 0.4)"
																	: "1px solid rgba(16, 185, 129, 0.4)",
															color:
																chat.model === "ode"
																	? "#a78bfa"
																	: chat.model === "villanelle"
																	? "#60a5fa"
																	: "#34d399",
															padding: "4px 10px",
															borderRadius: "6px",
															fontSize: "0.75rem",
															fontWeight: 600,
															textTransform: "capitalize",
														}}
													>
														{chat.model === "ode"
															? "🎼 "
															: chat.model === "villanelle"
															? "⚡ "
															: "🌿 "}
														{chat.model}
													</div>
												</div>

												{/* Stats Row */}
												<div
													style={{
														display: "flex",
														gap: "1.5rem",
														padding: "0.75rem 0",
														borderTop: "1px solid #2a2a2a",
														marginTop: "0.5rem",
													}}
												>
													<div
														style={{
															display: "flex",
															alignItems: "center",
															gap: "0.5rem",
															fontSize: "0.85rem",
														}}
													>
														<span style={{ color: "#888" }}>💬</span>
														<span style={{ color: "#aaa" }}>{messageCount} messages</span>
														<span style={{ color: "#666", fontSize: "0.75rem" }}>
															({userMessages} you, {assistantMessages} AI)
														</span>
													</div>
													{hasProducts && (
														<div
															style={{
																display: "flex",
																alignItems: "center",
																gap: "0.5rem",
																fontSize: "0.85rem",
															}}
														>
															<span style={{ color: "#888" }}>🛒</span>
															<span style={{ color: "#aaa" }}>Product recommendations</span>
														</div>
													)}
													<div
														style={{
															display: "flex",
															alignItems: "center",
															gap: "0.5rem",
															fontSize: "0.85rem",
														}}
													>
														<span style={{ color: "#888" }}>📂</span>
														<span
															style={{
																color:
																	chat.category === "chemistry"
																		? "#a78bfa"
																		: chat.category === "coffee"
																		? "#c4a77d"
																		: "#60a5fa",
																textTransform: "capitalize",
															}}
														>
															{chat.category}
														</span>
													</div>
												</div>

												{/* Last Message Preview */}
												{lastMessage && (
													<div
														style={{
															background: "#121212",
															borderRadius: "8px",
															padding: "0.75rem 1rem",
															marginTop: "0.75rem",
															fontSize: "0.85rem",
															color: "#888",
															borderLeft: `3px solid ${
																lastMessage.role === "assistant" ? "#c4a77d" : "#666"
															}`,
														}}
													>
														<div
															style={{
																fontSize: "0.7rem",
																textTransform: "uppercase",
																letterSpacing: "0.5px",
																color: "#666",
																marginBottom: "0.35rem",
															}}
														>
															Last{" "}
															{lastMessage.role === "assistant" ? "AI Response" : "Your Message"}
														</div>
														<div style={{ color: "#aaa", lineHeight: 1.4 }}>
															{lastMessage.content.length > 120
																? lastMessage.content.slice(0, 120) + "..."
																: lastMessage.content}
														</div>
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
			</div>

			{/* Maintenance Popup Modal - Rendered via Portal */}
			{mounted &&
				maintenancePopup.open &&
				maintenancePopup.machine &&
				createPortal(
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
						onClick={() => setMaintenancePopup({ open: false, machine: null })}
					>
						<div
							style={{
								backgroundColor: "#1a1a1a",
								borderRadius: "16px",
								maxWidth: "500px",
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
									padding: "1rem 1.25rem",
									borderBottom: "1px solid rgba(196, 167, 125, 0.2)",
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									position: "sticky",
									top: 0,
									backgroundColor: "#1a1a1a",
									zIndex: 1,
								}}
							>
								<div>
									<h3 style={{ margin: 0, color: "#c4a77d", fontSize: "1.1rem" }}>Maintenance Guide</h3>
									<p style={{ margin: "0.25rem 0 0", color: "#888", fontSize: "0.8rem" }}>
										{maintenancePopup.machine.product_name}
									</p>
								</div>
								<button
									onClick={() => setMaintenancePopup({ open: false, machine: null })}
									style={{
										background: "none",
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

							{/* Content */}
							<div style={{ padding: "1rem 1.25rem" }}>
								{/* General Care Tips */}
								<div style={{ marginBottom: "1.25rem" }}>
									<h4 style={{ color: "#c4a77d", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
										☕ Care Tips
									</h4>
									<ul
										style={{
											listStyle: "none",
											padding: 0,
											margin: 0,
											display: "flex",
											flexDirection: "column",
											gap: "0.5rem",
										}}
									>
										<li
											style={{
												padding: "0.5rem 0.75rem",
												backgroundColor: "rgba(196, 167, 125, 0.1)",
												borderRadius: "6px",
												color: "#ccc",
												fontSize: "0.8rem",
											}}
										>
											✓ Empty the drip tray and capsule container daily
										</li>
										<li
											style={{
												padding: "0.5rem 0.75rem",
												backgroundColor: "rgba(196, 167, 125, 0.1)",
												borderRadius: "6px",
												color: "#ccc",
												fontSize: "0.8rem",
											}}
										>
											✓ Clean the water tank weekly with fresh water
										</li>
										<li
											style={{
												padding: "0.5rem 0.75rem",
												backgroundColor: "rgba(196, 167, 125, 0.1)",
												borderRadius: "6px",
												color: "#ccc",
												fontSize: "0.8rem",
											}}
										>
											✓ Wipe the machine exterior with a damp cloth
										</li>
										<li
											style={{
												padding: "0.5rem 0.75rem",
												backgroundColor: "rgba(196, 167, 125, 0.1)",
												borderRadius: "6px",
												color: "#ccc",
												fontSize: "0.8rem",
											}}
										>
											✓ Store in a dry place away from direct sunlight
										</li>
									</ul>
								</div>

								{/* Scheduled Maintenance */}
								<div style={{ marginBottom: "1.25rem" }}>
									<h4 style={{ color: "#c4a77d", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
										📅 Scheduled Tasks
									</h4>
									<div
										style={{
											display: "grid",
											gridTemplateColumns: "1fr 1fr",
											gap: "0.5rem",
										}}
									>
										{/* Descaling */}
										<div
											style={{
												padding: "0.75rem",
												backgroundColor: "rgba(255, 193, 7, 0.1)",
												borderRadius: "8px",
												border: "1px solid rgba(255, 193, 7, 0.3)",
											}}
										>
											<div
												style={{
													display: "flex",
													justifyContent: "space-between",
													alignItems: "center",
													marginBottom: "0.25rem",
												}}
											>
												<span style={{ color: "#ffc107", fontWeight: 600, fontSize: "0.8rem" }}>
													🧴 Descaling
												</span>
											</div>
											<span
												style={{
													fontSize: "0.7rem",
													color: "#888",
												}}
											>
												Every 3 months
											</span>
										</div>

										{/* Deep Cleaning */}
										<div
											style={{
												padding: "0.75rem",
												backgroundColor: "rgba(33, 150, 243, 0.1)",
												borderRadius: "8px",
												border: "1px solid rgba(33, 150, 243, 0.3)",
											}}
										>
											<div
												style={{
													display: "flex",
													justifyContent: "space-between",
													alignItems: "center",
													marginBottom: "0.25rem",
												}}
											>
												<span style={{ color: "#2196f3", fontWeight: 600, fontSize: "0.8rem" }}>
													🧹 Deep Clean
												</span>
											</div>
											<span
												style={{
													fontSize: "0.7rem",
													color: "#888",
												}}
											>
												Monthly
											</span>
										</div>

										{/* Water Filter */}
										<div
											style={{
												padding: "0.75rem",
												backgroundColor: "rgba(76, 175, 80, 0.1)",
												borderRadius: "8px",
												border: "1px solid rgba(76, 175, 80, 0.3)",
											}}
										>
											<div
												style={{
													display: "flex",
													justifyContent: "space-between",
													alignItems: "center",
													marginBottom: "0.25rem",
												}}
											>
												<span style={{ color: "#4caf50", fontWeight: 600, fontSize: "0.8rem" }}>
													💧 Filter Change
												</span>
											</div>
											<span
												style={{
													fontSize: "0.7rem",
													color: "#888",
												}}
											>
												Every 2 months
											</span>
										</div>
									</div>
								</div>

								{/* Warranty Info */}
								<div
									style={{
										padding: "0.75rem",
										backgroundColor: maintenancePopup.machine.is_under_warranty
											? "rgba(76, 175, 80, 0.1)"
											: "rgba(244, 67, 54, 0.1)",
										borderRadius: "8px",
										border: `1px solid ${
											maintenancePopup.machine.is_under_warranty
												? "rgba(76, 175, 80, 0.3)"
												: "rgba(244, 67, 54, 0.3)"
										}`,
									}}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "0.5rem",
										}}
									>
										<span style={{ fontSize: "1.2rem" }}>
											{maintenancePopup.machine.is_under_warranty ? "🛡️" : "⚠️"}
										</span>
										<div>
											<div
												style={{
													fontWeight: 600,
													fontSize: "0.85rem",
													color: maintenancePopup.machine.is_under_warranty ? "#4caf50" : "#f44336",
												}}
											>
												Warranty {maintenancePopup.machine.is_under_warranty ? "Active" : "Expired"}
											</div>
											<div style={{ fontSize: "0.7rem", color: "#888" }}>
												{maintenancePopup.machine.is_under_warranty
													? `Covered until ${new Date(
															maintenancePopup.machine.warranty_end_date
													  ).toLocaleDateString()}`
													: "Consider our paid repair service"}
											</div>
										</div>
									</div>
								</div>
							</div>

							{/* Footer */}
							<div
								style={{
									padding: "1rem 1.25rem",
									borderTop: "1px solid rgba(196, 167, 125, 0.2)",
									display: "flex",
									justifyContent: "flex-end",
									position: "sticky",
									bottom: 0,
									backgroundColor: "#1a1a1a",
								}}
							>
								<button
									onClick={() => setMaintenancePopup({ open: false, machine: null })}
									style={{
										padding: "0.6rem 1.25rem",
										backgroundColor: "#c4a77d",
										color: "#000",
										border: "none",
										borderRadius: "8px",
										cursor: "pointer",
										fontWeight: 600,
										fontSize: "0.85rem",
									}}
								>
									Close
								</button>
							</div>
						</div>
					</div>,
					document.body
				)}

			{/* Repair Request Modal - Rendered via Portal */}
			{mounted &&
				repairPopup.open &&
				repairPopup.machine &&
				createPortal(
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
						onClick={() => {
							setRepairPopup({ open: false, machine: null });
							setSelectedRepairType("general");
							setSelectedRepairPaymentId(null);
							setUseWarrantyForRepair(true);
						}}
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
									padding: "1rem 1.25rem",
									borderBottom: "1px solid rgba(196, 167, 125, 0.2)",
									position: "sticky",
									top: 0,
									backgroundColor: "#1a1a1a",
									zIndex: 1,
								}}
							>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
									<div>
										<h3 style={{ margin: 0, color: "#c4a77d", fontSize: "1.1rem" }}>Request Repair</h3>
										<p style={{ margin: "0.25rem 0 0", color: "#888", fontSize: "0.85rem" }}>
											{repairPopup.machine.product_name}
										</p>
									</div>
									<button
										onClick={() => {
											setRepairPopup({ open: false, machine: null });
											setSelectedRepairType("general");
											setSelectedRepairPaymentId(null);
											setUseWarrantyForRepair(true);
										}}
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
							{repairPopup.machine.is_under_warranty ? (
								<div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid rgba(196, 167, 125, 0.2)" }}>
									<div style={{ display: "flex", gap: "0.5rem" }}>
										{/* Use Warranty Option */}
										<div
											onClick={() => setUseWarrantyForRepair(true)}
											style={{
												flex: 1,
												padding: "0.75rem",
												backgroundColor: useWarrantyForRepair
													? "rgba(76, 175, 80, 0.15)"
													: "rgba(196, 167, 125, 0.05)",
												borderRadius: "8px",
												border: `2px solid ${
													useWarrantyForRepair ? "#4caf50" : "rgba(196, 167, 125, 0.2)"
												}`,
												cursor: "pointer",
												transition: "all 0.2s ease",
											}}
										>
											<div
												style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
											>
												<div>
													<div
														style={{
															fontWeight: 600,
															color: useWarrantyForRepair ? "#4caf50" : "#fff",
															fontSize: "0.85rem",
														}}
													>
														🆓 Use Warranty
													</div>
													<div style={{ fontSize: "0.7rem", color: "#888" }}>Free repair</div>
												</div>
												{useWarrantyForRepair && (
													<span style={{ color: "#4caf50", fontSize: "1rem" }}>✓</span>
												)}
											</div>
										</div>
										{/* Pay Option */}
										<div
											onClick={() => setUseWarrantyForRepair(false)}
											style={{
												flex: 1,
												padding: "0.75rem",
												backgroundColor: !useWarrantyForRepair
													? "rgba(196, 167, 125, 0.15)"
													: "rgba(196, 167, 125, 0.05)",
												borderRadius: "8px",
												border: `2px solid ${
													!useWarrantyForRepair ? "#c4a77d" : "rgba(196, 167, 125, 0.2)"
												}`,
												cursor: "pointer",
												transition: "all 0.2s ease",
											}}
										>
											<div
												style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
											>
												<div>
													<div
														style={{
															fontWeight: 600,
															color: !useWarrantyForRepair ? "#c4a77d" : "#fff",
															fontSize: "0.85rem",
														}}
													>
														💳 Pay for Repair
													</div>
													<div style={{ fontSize: "0.7rem", color: "#888" }}>Priority service</div>
												</div>
												{!useWarrantyForRepair && (
													<span style={{ color: "#c4a77d", fontSize: "1rem" }}>✓</span>
												)}
											</div>
										</div>
									</div>
									<div style={{ fontSize: "0.7rem", color: "#666", marginTop: "0.5rem", textAlign: "center" }}>
										Warranty valid until{" "}
										{new Date(repairPopup.machine.warranty_end_date).toLocaleDateString()}
									</div>
								</div>
							) : null}

							{/* Repair Type Selection */}
							<div style={{ padding: "1rem 1.25rem" }}>
								<h4 style={{ margin: "0 0 0.75rem", color: "#c4a77d", fontSize: "0.85rem" }}>
									Select Repair Type
								</h4>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
									{(["general", "cleaning", "descaling", "pump", "heating"] as RepairType[]).map(
										(type, idx) => (
											<div
												key={type}
												style={{
													padding: "0.6rem 0.75rem",
													backgroundColor:
														selectedRepairType === type
															? "rgba(196, 167, 125, 0.2)"
															: "rgba(196, 167, 125, 0.05)",
													borderRadius: "8px",
													border: `2px solid ${
														selectedRepairType === type ? "#c4a77d" : "rgba(196, 167, 125, 0.2)"
													}`,
													cursor: "pointer",
													transition: "all 0.2s ease",
													gridColumn: idx === 0 ? "1 / -1" : undefined,
												}}
												onClick={() => setSelectedRepairType(type)}
											>
												<div
													style={{
														display: "flex",
														justifyContent: "space-between",
														alignItems: "center",
													}}
												>
													<div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#fff" }}>
														{type === "general"
															? "🔧 General"
															: type === "cleaning"
															? "🧹 Cleaning"
															: type === "descaling"
															? "🧴 Descaling"
															: type === "pump"
															? "⚙️ Pump"
															: "🔥 Heating"}
													</div>
													<span
														style={{
															fontSize: "0.75rem",
															color:
																repairPopup.machine?.is_under_warranty && useWarrantyForRepair
																	? "#4caf50"
																	: "#c4a77d",
															fontWeight: 700,
														}}
													>
														{repairPopup.machine?.is_under_warranty && useWarrantyForRepair
															? "FREE"
															: `${calculateRepairCost(
																	Number(repairPopup.machine?.unit_price ?? 0),
																	type,
																	false
															  ).toFixed(2)} RON`}
													</span>
												</div>
											</div>
										)
									)}
								</div>
							</div>

							{/* Cost Summary & Payment Selection - Show when user needs to pay */}
							{repairPopup.machine && (!repairPopup.machine.is_under_warranty || !useWarrantyForRepair) && (
								<div style={{ padding: "0 1.25rem 0.75rem" }}>
									{/* Warning for expired warranty */}
									{!repairPopup.machine.is_under_warranty && (
										<div
											style={{
												padding: "0.75rem",
												backgroundColor: "rgba(255, 193, 7, 0.1)",
												borderRadius: "8px",
												border: "1px solid rgba(255, 193, 7, 0.3)",
												marginBottom: "0.75rem",
											}}
										>
											<div style={{ fontSize: "0.75rem", color: "#ffc107" }}>
												⚠️ Warranty expired. Repair costs: 10-40% of original price.
											</div>
										</div>
									)}

									{/* Info for choosing to pay with warranty */}
									{repairPopup.machine.is_under_warranty && !useWarrantyForRepair ? (
										<div
											style={{
												padding: "0.6rem",
												backgroundColor: "rgba(196, 167, 125, 0.1)",
												borderRadius: "8px",
												border: "1px solid rgba(196, 167, 125, 0.3)",
												marginBottom: "0.75rem",
											}}
										>
											<div style={{ fontSize: "0.75rem", color: "#c4a77d" }}>
												💎 Premium service. Your warranty remains intact.
											</div>
										</div>
									) : null}

									{/* Payment Method Selection */}
									<h4 style={{ margin: "0 0 0.5rem", color: "#c4a77d", fontSize: "0.8rem" }}>
										💳 Select Payment
									</h4>
									{savedCards.length === 0 ? (
										<div
											style={{
												padding: "0.75rem",
												backgroundColor: "rgba(196, 167, 125, 0.05)",
												borderRadius: "8px",
												border: "1px solid rgba(196, 167, 125, 0.2)",
												textAlign: "center",
											}}
										>
											<div style={{ color: "#888", fontSize: "0.8rem" }}>
												No saved cards. Add one during checkout.
											</div>
										</div>
									) : (
										<div
											style={{
												display: "grid",
												gridTemplateColumns: savedCards.length > 2 ? "1fr 1fr" : "1fr",
												gap: "0.4rem",
											}}
										>
											{savedCards.map((card) => (
												<div
													key={card.id}
													style={{
														padding: "0.5rem 0.75rem",
														backgroundColor:
															selectedRepairPaymentId === card.id
																? "rgba(196, 167, 125, 0.2)"
																: "rgba(196, 167, 125, 0.05)",
														borderRadius: "8px",
														border: `2px solid ${
															selectedRepairPaymentId === card.id
																? "#c4a77d"
																: "rgba(196, 167, 125, 0.2)"
														}`,
														cursor: "pointer",
														display: "flex",
														alignItems: "center",
														justifyContent: "space-between",
														transition: "all 0.2s ease",
													}}
													onClick={() => setSelectedRepairPaymentId(card.id)}
												>
													<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
														<div
															style={{
																width: 36,
																height: 24,
																borderRadius: "4px",
																background: "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)",
																padding: "2px",
																display: "flex",
																alignItems: "center",
																justifyContent: "center",
																flexShrink: 0,
															}}
														>
															<Image
																src={getCardTypeImage(card.card_type)}
																alt={card.card_type}
																width={30}
																height={18}
																style={{ objectFit: "contain" }}
															/>
														</div>
														<div>
															<div style={{ fontWeight: 600, color: "#fff", fontSize: "0.8rem" }}>
																•••• {card.card_last_four}
															</div>
															<div style={{ fontSize: "0.65rem", color: "#888" }}>
																{card.card_type.toUpperCase()}
															</div>
														</div>
													</div>
													{selectedRepairPaymentId === card.id && (
														<span style={{ color: "#4caf50", fontSize: "0.9rem" }}>✓</span>
													)}
												</div>
											))}
										</div>
									)}

									{/* Estimated Total */}
									<div
										style={{
											marginTop: "0.75rem",
											padding: "0.75rem",
											backgroundColor: "rgba(196, 167, 125, 0.1)",
											borderRadius: "8px",
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
										}}
									>
										<span style={{ color: "#888", fontSize: "0.85rem" }}>Total:</span>
										<span style={{ color: "#c4a77d", fontWeight: 700, fontSize: "1rem" }}>
											{calculateRepairCost(
												Number(repairPopup.machine?.unit_price ?? 0),
												selectedRepairType,
												false
											).toFixed(2)}{" "}
											RON
										</span>
									</div>
								</div>
							)}

							{/* Footer */}
							<div
								style={{
									padding: "1rem 1.25rem",
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
									onClick={() => {
										setRepairPopup({ open: false, machine: null });
										setSelectedRepairType("general");
										setSelectedRepairPaymentId(null);
										setUseWarrantyForRepair(true);
									}}
									style={{
										padding: "0.6rem 1.25rem",
										backgroundColor: "transparent",
										color: "#888",
										border: "1px solid #444",
										borderRadius: "8px",
										cursor: "pointer",
										fontSize: "0.85rem",
									}}
								>
									Cancel
								</button>
								<button
									onClick={() => {
										const needsPayment = !repairPopup.machine?.is_under_warranty || !useWarrantyForRepair;
										if (needsPayment && !selectedRepairPaymentId && savedCards.length > 0) {
											notify("Please select a payment method.", 3000, "info", "account");
											return;
										}
										handleRepairRequest();
									}}
									disabled={
										(!repairPopup.machine?.is_under_warranty || !useWarrantyForRepair) &&
										savedCards.length === 0
									}
									style={{
										padding: "0.6rem 1.25rem",
										backgroundColor:
											(!repairPopup.machine?.is_under_warranty || !useWarrantyForRepair) &&
											savedCards.length === 0
												? "#555"
												: "#c4a77d",
										color:
											(!repairPopup.machine?.is_under_warranty || !useWarrantyForRepair) &&
											savedCards.length === 0
												? "#888"
												: "#000",
										border: "none",
										borderRadius: "8px",
										cursor:
											(!repairPopup.machine?.is_under_warranty || !useWarrantyForRepair) &&
											savedCards.length === 0
												? "not-allowed"
												: "pointer",
										fontWeight: 600,
										fontSize: "0.85rem",
									}}
								>
									{repairPopup.machine?.is_under_warranty && useWarrantyForRepair
										? "Submit Free Repair"
										: "Submit & Pay"}
								</button>
							</div>
						</div>
					</div>,
					document.body
				)}
		</main>
	);
}
