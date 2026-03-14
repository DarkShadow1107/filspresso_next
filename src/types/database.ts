/**
 * DATABASE TYPES: Matches express-api/data/schema.sql
 * This file serves as the single source of truth for the project's data models.
 */

export type Timestamp = string | Date;

// --- 1. ACCOUNTS & AUTH ---

export interface DBAccount {
	id: number;
	username: string;
	email: string;
	password_hash: string;
	name: string | null;
	icon: string | null;
	subscription_id: number | null;
	role: "admin" | "user";
	graph_theme: string;
	email_verified: boolean;
	last_login: Timestamp | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBUserCard {
	id: number;
	account_id: number;
	card_number_encrypted: string;
	card_expiry_encrypted: string;
	card_expiry?: string;
	card_holder: string;
	card_type: string;
	card_last_four: string;
	is_default: boolean;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBUserSession {
	id: number;
	account_id: number;
	session_token: string;
	expires_at: Timestamp;
	ip_address: string | null;
	user_agent: string | null;
	created_at: Timestamp;
}

// --- 2. COMMERCE & INVENTORY ---

export interface DBCoffeeProduct {
	id: number;
	product_id: string;
	product_type: "original" | "vertuo";
	category: string;
	name: string;
	price: number;
	stock: number;
	description: string | null;
	notes: any | null; // JSONB
	servings: any | null; // JSONB
	intensity: number | null;
	image_filename: string | null;
	image_extension: string;
	image_style: string | null;
	price_class: string | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBMachineProduct {
	id: number;
	product_id: string;
	product_type: "original" | "vertuo";
	category: string;
	name: string;
	price: number;
	stock: number;
	description: string | null;
	notes: any | null; // JSONB
	image: string | null;
	box_class: string | null;
	wrapper_class: string | null;
	unit_label: string | null;
	price_class: string | null;
	price_text: string | null;
	extra_class: any | null; // JSONB
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBOrder {
	id: number;
	account_id: number;
	order_number: string;
	status: "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";
	subtotal: number;
	shipping_cost: number;
	tax: number;
	total: number;
	shipping_address: any | null; // JSONB
	billing_address: any | null; // JSONB
	payment_method: string | null;
	card_id: number | null;
	notes: string | null;
	weather_condition: string;
	estimated_delivery: string;
	expected_delivery_date: string | null;
	currency_code: string;
	exchange_rate: number;
	conversion_fee_percent: number;
	charged_subtotal: number;
	charged_shipping_cost: number;
	charged_tax: number;
	charged_total: number;
	destination_country: string | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBOrderItem {
	id: number;
	order_id: number;
	product_type: "capsule" | "machine" | "accessory" | "subscription" | "service";
	product_id: string;
	product_name: string;
	product_image: string | null;
	quantity: number;
	unit_price: number;
	total_price: number;
	created_at: Timestamp;
}

export interface DBCartItem {
	id: number;
	account_id: number;
	product_type: "capsule" | "machine" | "accessory";
	product_id: string;
	product_name: string;
	product_image: string | null;
	unit_price: number;
	quantity: number;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBFavorite {
	id: number;
	account_id: number;
	product_type: "capsule" | "machine";
	product_category: string | null;
	product_id: string;
	created_at: Timestamp;
}

// --- 3. SUBSCRIPTIONS & LOYALTY ---

export interface DBSubscriptionPlan {
	id: number;
	name: string;
	description: string | null;
	price_ron: number;
	features: any; // JSONB
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBUserSubscription {
	id: number;
	account_id: number;
	plan_id: string | null;
	subscription_tier: string;
	status: "active" | "canceled" | "expired";
	billing_cycle: "monthly" | "yearly";
	price_ron: number;
	start_date: string | Date;
	renewal_date: string | Date | null;
	end_date: string | Date | null;
	auto_renew: boolean;
	is_active: boolean;
	card_id: number | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBMemberStatus {
	id: number;
	account_id: number;
	total_capsules: number;
	original_capsules: number;
	vertuo_capsules: number;
	current_tier: string;
	highest_tier_achieved: string;
	current_year_capsules: number;
	current_year_start: string | Date;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBMemberStatusHistory {
	id: number;
	account_id: number;
	year: number;
	capsules_ordered: number;
	original_capsules: number;
	vertuo_capsules: number;
	order_count: number;
	highest_tier: string;
	created_at: Timestamp;
	updated_at: Timestamp;
}

// --- 4. CHAT, AI & IOT ---

export interface DBChatSession {
	id: number;
	account_id: number;
	session_uuid: string;
	title: string | null;
	model_type: "tanka" | "chemistry";
	ai_enabled: boolean;
	is_active: boolean;
	message_count: number;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBChatMessage {
	id: number;
	session_id: number;
	role: "user" | "assistant" | "system";
	content: string;
	tokens_used: number;
	response_time_ms: number;
	created_at: Timestamp;
}

export interface DBIoTCommand {
	id: number;
	machine_id: string;
	recipe: any; // JSONB
	execute_allowed: boolean;
	status: string;
	meta: any | null; // JSONB
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBCoffeeFact {
	id: number;
	fact: string;
	embedding: number[] | null; // pgvector
	created_at: Timestamp;
}

// --- 5. SERVICES & CACHE ---

export interface DBRepair {
	id: number;
	account_id: number;
	order_id: number | null;
	machine_id: string;
	machine_name: string;
	repair_type: string;
	is_warranty: boolean;
	estimated_cost: number;
	estimated_duration: number;
	weather_delay: boolean;
	warranty_delay: boolean;
	status: "pending" | "in_progress" | "completed" | "shipped" | "delivered";
	pickup_date: Timestamp | null;
	payment_card_id: number | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface DBWeatherCache {
	id: number;
	cache_key: string;
	data: any;
	timestamp: Timestamp;
}

export interface DBMolecule {
	id: number;
	name: string | null;
	smiles: string;
	molecule: any | null; // rdkit mol type
	created_at: Timestamp;
}
