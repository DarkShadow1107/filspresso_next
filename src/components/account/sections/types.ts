// Shared types for Account Management sections
import React from "react";
import {
	CoffeeIcon,
	StarIcon,
	SparklesIcon,
	ShieldCheck as ShieldCheckIcon,
	RosetteDiscountIcon,
	RosetteDiscountCheckIcon,
	RocketIcon,
	ChartBarIcon,
	FileDescriptionIcon,
	GearIcon,
	ClockIcon,
	PartyPopperIcon,
	HistoryCircleIcon,
} from "@/icons";

import {
	DBAccount,
	DBUserCard,
	DBOrder,
	DBOrderItem,
	DBUserSubscription,
	DBRepair,
	DBChatSession,
	DBChatMessage,
	Timestamp,
} from "@/types/database";
import { readAccountSession } from "@/lib/accountSession";

export type AccountData = Pick<DBAccount, "username" | "email" | "icon"> & {
	full_name: string | null;
	created_at?: Timestamp;
	mfa?: {
		enabled: boolean;
		enabledAt?: Timestamp | null;
	};
};

export type Message = { role: DBChatMessage["role"]; content: string; products?: unknown[] };
export type ChatHistory = {
	id: string;
	timestamp: number;
	messages: Message[];
	preview: string;
	model: DBChatSession["model_type"];
	category: "coffee" | "chemistry" | "general";
};

export type SubscriptionTier = "none" | "free" | "basic" | "plus" | "pro" | "max" | "ultimate";

export type SavedCard = DBUserCard;

export type OrderItem = DBOrderItem;

export type Order = DBOrder & {
	items?: OrderItem[];
	item_count?: number;
	discount_tier?: string | null;
	discount_percent?: number;
	discount_amount?: number;
	card_type?: string;
	card_last_four?: string;
};

export type Subscription = Partial<DBUserSubscription> & {
	tier: string;
	card?: {
		id: number;
		last_four: string;
		type: string;
	} | null;
};

export type UserMachine = DBRepair & {
	model?: string;
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
	totalOrders: number;
	totalRepairs: number;
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
export const API_BASE = typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";

export const TIER_BENEFITS: Record<
	string,
	{ icon: string; iconComponent: React.ElementType; discount: number; benefits: string[] }
> = {
	None: {
		icon: "☕",
		iconComponent: CoffeeIcon,
		discount: 0,
		benefits: [
			"Order your first capsules to unlock member benefits!",
			"Access to all capsule varieties",
			"Standard customer support",
		],
	},
	Connoisseur: {
		icon: "🎖️",
		iconComponent: RosetteDiscountIcon,
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
		iconComponent: StarIcon,
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
		iconComponent: RosetteDiscountCheckIcon,
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
		iconComponent: SparklesIcon,
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
		iconComponent: ShieldCheckIcon,
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
	let url = icon.trim();

	// Prevent double-prefixing if it already contains the target path
	if (url.startsWith("/images/icons/") || url.startsWith("images/icons/")) {
		if (!url.startsWith("/")) url = "/" + url;
	} else if (url.startsWith("/") || url.startsWith("http") || url.startsWith("data:")) {
		// Convert old /api/icons/ paths if they exist
		if (url.startsWith("/api/icons/")) {
			url = url.replace("/api/icons/", "/images/icons/");
		}
	} else {
		// Otherwise it's just a filename, construct the full relative path
		url = `/images/icons/${url}`;
	}

	// Keep internal icon paths normalized while preserving explicit extensions.
	if (url.startsWith("/images/icons/") && !url.startsWith("data:")) {
		url = url.toLowerCase();
		if (!/\.(svg|png|jpe?g|ico|webp|avif)(\?.*)?$/i.test(url)) {
			url = `${url}.svg`;
		}
	}

	// Safety check: if it's a relative path with spaces, encode it
	if (url.startsWith("/") && !url.startsWith("data:")) {
		try {
			if (url.includes(" ") || url.includes("[") || url.includes("]")) {
				return encodeURI(url);
			}
		} catch (e) {
			return url;
		}
	}
	return url;
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

export const formatDate = (dateString: string | number | Date) => {
	try {
		const date = new Date(dateString);
		if (isNaN(date.getTime())) return "Date unavailable";
		return date.toLocaleDateString("en-US", {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
		});
	} catch (e) {
		return "Date unavailable";
	}
};

export const getAuthToken = (): string | null => {
	if (typeof window === "undefined") return null;
	try {
		const session = readAccountSession();
		if (session) {
			const { token } = session;
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
