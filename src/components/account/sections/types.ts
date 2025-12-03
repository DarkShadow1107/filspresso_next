// Shared types for Account Management sections

export type AccountData = {
	full_name: string | null;
	username: string;
	email: string;
	icon: string | null;
};

export type Message = { role: "user" | "assistant"; content: string; products?: any[] };
export type ChatHistory = {
	id: string;
	timestamp: number;
	messages: Message[];
	preview: string;
	model: "tanka" | "villanelle" | "ode";
	category: "coffee" | "chemistry" | "general";
};

export type SubscriptionTier = "none" | "free" | "basic" | "plus" | "pro" | "max" | "ultimate";

export type SavedCard = {
	id: number;
	card_holder: string;
	card_type: string;
	card_last_four: string;
	card_expiry: string;
	is_default: boolean;
	created_at: string;
};

export type OrderItem = {
	id: number;
	product_type?: string;
	product_id?: string;
	product_name: string;
	product_image: string | null;
	quantity: number;
	unit_price: number;
	total_price: number;
};

export type Order = {
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
	discount_tier?: string | null;
	discount_percent?: number;
	discount_amount?: number;
	card_type?: string;
	card_last_four?: string;
};

export type Subscription = {
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

export type UserMachine = {
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

export type MemberTier = {
	name: "None" | "Connoisseur" | "Expert" | "Master" | "Virtuoso" | "Ambassador";
	level: 0 | 1 | 2 | 3 | 4 | 5;
};

export type NextTierInfo = {
	name: string;
	needed: number;
	remaining: number;
} | null;

export type YearlyTierHistory = {
	year: number;
	capsules: number;
	orders: number;
	tier: string;
	tierLevel: number;
	originalCapsules: number;
	vertuoCapsules: number;
};

export type CapsuleStats = {
	totalCapsules: number;
	originalCapsules: number;
	vertuoCapsules: number;
	machineStats: {
		total: number;
		original: number;
		vertuo: number;
	};
	currentPeriod: {
		capsules: number;
		startDate: string;
		endDate: string;
		daysRemaining: number;
	};
	currentTier: MemberTier;
	nextTier: NextTierInfo;
	yearlyHistory: YearlyTierHistory[];
	accountCreatedAt: string;
};

export type ConsumptionHistory = {
	accountCreatedAt: string;
	capsules: { date: string; original_capsules: number; vertuo_capsules: number }[];
	machines: { date: string; original_machines: number; vertuo_machines: number }[];
};

export type RepairType = "cleaning" | "descaling" | "pump" | "heating" | "general";

export type Repair = {
	id: number;
	order_id: number | null;
	order_number?: string;
	machine_id: string;
	machine_name: string;
	repair_type: RepairType;
	is_warranty: boolean;
	estimated_cost: number;
	actual_cost: number | null;
	estimated_duration: number;
	weather_delay: boolean;
	warranty_delay: boolean;
	status: "pending" | "received" | "diagnosing" | "repairing" | "testing" | "ready" | "completed" | "cancelled";
	technician_notes: string | null;
	customer_notes: string | null;
	pickup_date: string | null;
	completion_date: string | null;
	created_at: string;
	updated_at: string;
	card_type?: string;
	card_last_four?: string;
};

export type MaintenanceInfo = {
	title: string;
	description: string;
	frequency: string;
	steps: string[];
};

// Shared constants
export const API_BASE = "http://localhost:4000";

export const TIER_BENEFITS: Record<string, { icon: string; discount: number; benefits: string[] }> = {
	None: {
		icon: "☕",
		discount: 0,
		benefits: [
			"Order your first capsules to unlock member benefits!",
			"Access to all capsule varieties",
			"Standard customer support",
		],
	},
	Connoisseur: {
		icon: "🎖️",
		discount: 5,
		benefits: [
			"5% discount on all orders",
			"Access to all capsule varieties",
			"Early access to new capsule releases",
			"Birthday surprise gift",
			"Priority customer support",
		],
	},
	Expert: {
		icon: "⭐",
		discount: 10,
		benefits: [
			"10% discount on all orders",
			"Free shipping on orders over 150 RON",
			"Access to all capsule varieties",
			"Early access to new capsule releases",
			"Birthday surprise gift",
			"Priority customer support",
			"3 free sample capsules per order",
			"Exclusive limited edition access",
		],
	},
	Master: {
		icon: "🏆",
		discount: 15,
		benefits: [
			"15% discount on all orders",
			"Free shipping on all orders",
			"Access to all capsule varieties",
			"Early access to new capsule releases",
			"Birthday surprise gift",
			"Priority customer support",
			"5 free premium capsules per month",
			"Exclusive limited edition access",
			"Free machine maintenance (1x/year)",
		],
	},
	Virtuoso: {
		icon: "💎",
		discount: 18,
		benefits: [
			"18% discount on all orders",
			"Free shipping on all orders",
			"Access to all capsule varieties",
			"Early access to new capsule releases",
			"Birthday surprise gift",
			"Priority customer support",
			"8 free premium capsules per month",
			"Exclusive limited edition access",
			"Free machine maintenance (1x/year)",
			"Exclusive tasting events access",
			"Priority machine repairs",
			"Quarterly surprise gift box",
		],
	},
	Ambassador: {
		icon: "👑",
		discount: 20,
		benefits: [
			"20% discount on all orders",
			"Free shipping on all orders",
			"Access to all capsule varieties",
			"Early access to new capsule releases",
			"Birthday surprise gift",
			"Priority customer support",
			"10 free premium capsules per month",
			"Exclusive limited edition access",
			"Free machine maintenance (1x/year)",
			"Exclusive tasting events access",
			"Priority machine repairs",
			"Quarterly surprise gift box",
			"Exclusive Ambassador events & tastings",
			"Free machine upgrades",
			"Dedicated personal account manager",
			"Early access to new machines",
		],
	},
};

export const TIER_THRESHOLDS = [
	{ tier: "None", min: 0, max: 0 },
	{ tier: "Connoisseur", min: 1, max: 749 },
	{ tier: "Expert", min: 750, max: 1999 },
	{ tier: "Master", min: 2000, max: 3999 },
	{ tier: "Virtuoso", min: 4000, max: 6999 },
	{ tier: "Ambassador", min: 7000, max: Infinity },
];

export const TIER_COLORS: Record<string, { primary: string; secondary: string; bg: string }> = {
	None: { primary: "#888", secondary: "#666", bg: "rgba(136, 136, 136, 0.15)" },
	Connoisseur: { primary: "#c4a77d", secondary: "#a67c52", bg: "rgba(196, 167, 125, 0.15)" },
	Expert: { primary: "#8b5cf6", secondary: "#7c3aed", bg: "rgba(139, 92, 246, 0.15)" },
	Master: { primary: "#10b981", secondary: "#059669", bg: "rgba(16, 185, 129, 0.15)" },
	Virtuoso: { primary: "#06b6d4", secondary: "#0891b2", bg: "rgba(6, 182, 212, 0.15)" },
	Ambassador: { primary: "#f59e0b", secondary: "#d97706", bg: "rgba(245, 158, 11, 0.15)" },
};

export const REPAIR_COSTS: Record<RepairType, { min: number; max: number; description: string }> = {
	cleaning: { min: 10, max: 15, description: "Professional deep cleaning" },
	descaling: { min: 15, max: 20, description: "Industrial descaling service" },
	pump: { min: 25, max: 35, description: "Pump repair or replacement" },
	heating: { min: 30, max: 40, description: "Heating element service" },
	general: { min: 20, max: 30, description: "General maintenance and inspection" },
};

// Shared helper functions
export const getIconUrl = (icon: string | null) => {
	if (!icon) return null;
	if (icon.startsWith("/") || icon.startsWith("http")) {
		if (icon.startsWith("/api/icons/")) {
			return icon.replace("/api/icons/", "/images/icons/");
		}
		return icon;
	}
	return `/images/icons/${icon}`;
};

export const getCardTypeImage = (cardType: string): string => {
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

export const formatDate = (dateString: string | number) => {
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

export const getAuthToken = (): string | null => {
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

export const gradientTextStyle = {
	background: "linear-gradient(135deg, rgb(196, 167, 125) 0%, rgb(166, 124, 82) 100%)",
	WebkitBackgroundClip: "text",
	WebkitTextFillColor: "transparent",
	backgroundClip: "text",
	color: "transparent",
	display: "inline-block",
};

export const calculateRepairCost = (machinePrice: number, repairType: RepairType, isWarranty: boolean): number => {
	if (isWarranty) return 0;
	const costRange = REPAIR_COSTS[repairType];
	const percentage = (costRange.min + costRange.max) / 2 / 100;
	return Math.round(machinePrice * percentage * 100) / 100;
};

// Re-export Subscription as SubscriptionData for backward compatibility
export type SubscriptionData = Subscription;
