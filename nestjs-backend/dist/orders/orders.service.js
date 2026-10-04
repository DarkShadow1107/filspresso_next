"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OrdersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const serviceAssertionUtils = __importStar(require("../common/utils/serviceAssertions"));
const serviceContracts = __importStar(require("../common/utils/serviceContracts"));
const TIER_DISCOUNTS = {
    None: 0, Connoisseur: 5, Expert: 10, Master: 15, Virtuoso: 18, Ambassador: 20,
};
const TIER_THRESHOLDS = [
    { tier: "Ambassador", min: 7000 }, { tier: "Virtuoso", min: 4000 },
    { tier: "Master", min: 2000 }, { tier: "Expert", min: 750 }, { tier: "Connoisseur", min: 1 },
];
/**
 * The only currency the catalogue prices are in.
 *
 * Historic orders carry RON, CHF, PLN, CZK, DKK and TRY against the same unconverted
 * numbers, so those totals were never actually converted. Rather than keep labelling a
 * RON amount as a foreign currency, checkout refuses it until there is an FX table.
 */
const CATALOGUE_CURRENCY = "RON";
/**
 * Flat shipping rate, in RON.
 *
 * There is no server-side shipping table anywhere, and shipping used to come straight
 * from the request body -- so a client could post any rate it liked, including zero.
 * This must be set to the real carrier cost; it is configuration, not a fact about the
 * system, which is why it is read from the environment rather than hardcoded.
 */
const SHIPPING_FLAT_RON = (() => {
    const raw = Number.parseFloat(String(process.env.SHIPPING_FLAT_RON ?? "24.99"));
    return Number.isFinite(raw) && raw >= 0 ? roundMoney(raw) : 24.99;
})();
/** Money is rounded to minor units at every step, never accumulated as a float. */
function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
/**
 * Coerce a shipping/billing address into something the jsonb column accepts.
 *
 * Both columns are jsonb, but the value used to be passed straight through from the
 * request as a string. A client that omitted the address therefore inserted `""`,
 * which is not valid JSON, and the whole insert failed with "invalid input syntax for
 * type json". A client that sent an object happened to work, which is why this went
 * unnoticed.
 *
 * Accepts an object, or a string that parses to one. Anything else becomes NULL rather
 * than an error, because a missing address is the client's problem to fix on the next
 * attempt and should not be able to fail the entire order.
 */
function normalizeAddress(value) {
    if (value === undefined || value === null || value === "")
        return null;
    const MAX_ADDRESS_BYTES = 8 * 1024;
    let candidate = value;
    if (typeof candidate === "string") {
        if (candidate.length > MAX_ADDRESS_BYTES)
            return null;
        const trimmed = candidate.trim();
        if (!trimmed)
            return null;
        try {
            candidate = JSON.parse(trimmed);
        }
        catch {
            return null;
        }
    }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
        return null;
    if (JSON.stringify(candidate).length > MAX_ADDRESS_BYTES)
        return null;
    return candidate;
}
/**
 * Best-effort product type, from the request.
 *
 * Only a label on the order line, and never used for pricing or stock -- those come
 * from whichever catalogue table the product was found in. The catalogue's own
 * `product_type` column holds values like "original", which is a different vocabulary
 * from the "capsule"/"machine" this column has always stored, so guessing from the id
 * is less wrong than trusting a client string.
 */
function productTypeFor(productId, items) {
    const match = items.find((i) => String(i["productId"] ?? i["product_id"] ?? "").trim() === productId);
    const declared = String(match?.["productType"] ?? match?.["product_type"] ?? "").trim().toLowerCase();
    if (declared)
        return declared;
    return productId.startsWith("pack-") || productId.startsWith("forfait-") ? "machine" : "capsule";
}
const FREE_SHIPPING_TIERS = ["Master", "Virtuoso", "Ambassador"];
function serializeBigInt(obj) {
    if (obj === null || obj === undefined)
        return obj;
    if (typeof obj === "bigint")
        return Number(obj);
    if (obj instanceof Date)
        return obj.toISOString();
    if (Array.isArray(obj))
        return obj.map(serializeBigInt);
    if (typeof obj === "object") {
        const result = {};
        for (const key in obj) {
            result[key] = serializeBigInt(obj[key]);
        }
        return result;
    }
    return obj;
}
let OrdersService = OrdersService_1 = class OrdersService {
    db;
    logger = new common_1.Logger(OrdersService_1.name);
    assertionPrivateKey;
    assertionIssuer;
    assertionSubject;
    assertionTtlSeconds;
    invoiceServiceUrl;
    invoiceRequireServiceAssertion;
    constructor(db) {
        this.db = db;
        this.assertionPrivateKey = String(process.env.SERVICE_ASSERTION_PRIVATE_KEY || "");
        this.assertionIssuer = String(process.env.SERVICE_ASSERTION_ISSUER || "filspresso-backend");
        this.assertionSubject = String(process.env.SERVICE_ASSERTION_SUBJECT || "backend");
        this.assertionTtlSeconds = Math.min(Math.max(Number.parseInt(process.env.SERVICE_ASSERTION_TTL_SECONDS || "120", 10) || 120, 30), 600);
        this.invoiceServiceUrl = String(process.env.INVOICE_SERVICE_URL || "http://localhost:8082");
        this.invoiceRequireServiceAssertion = String(process.env.INVOICE_REQUIRE_SERVICE_ASSERTION || "true").toLowerCase() === "true";
    }
    createServiceAssertion(scope) {
        if (!this.assertionPrivateKey)
            return "";
        try {
            const issued = serviceAssertionUtils.issueServiceAssertion({
                privateKeyPem: this.assertionPrivateKey, issuer: this.assertionIssuer,
                subject: this.assertionSubject, scope, ttlSeconds: this.assertionTtlSeconds,
            });
            return issued.token;
        }
        catch (e) {
            this.logger.warn(`Failed to issue service assertion: ${e instanceof Error ? e.message : String(e)}`);
            return "";
        }
    }
    // ── GET /api/orders/popular
    async getPopularProducts(limit) {
        const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 5, 1), 20);
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT product_id, product_name, product_image, total_ordered
         FROM popular_products_cache
         ORDER BY total_ordered DESC LIMIT $1`, [safeLimit]);
            const products = serializeBigInt(result.rows);
            return { products, total: products.length };
        }
        finally {
            client.release();
        }
    }
    // ── GET /api/orders/machines
    async getUserMachines(accountId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT oi.id, o.id as order_id, o.order_number, oi.product_type, oi.product_id,
                oi.product_name, oi.product_image, oi.unit_price, oi.quantity,
                o.created_at as purchase_date,
                (o.created_at + INTERVAL '3 years') as warranty_end_date,
                CASE WHEN (o.created_at + INTERVAL '3 years') > NOW() THEN TRUE ELSE FALSE END as is_under_warranty,
                CASE WHEN oi.product_id LIKE 'pack-%' OR oi.product_id LIKE 'forfait-%'
                          OR LOWER(oi.product_name) LIKE '%forfait%' THEN TRUE ELSE FALSE END as is_forfait
         FROM order_items oi JOIN orders o ON oi.order_id = o.id
         WHERE o.account_id = $1 AND o.status != 'cancelled' AND oi.product_type != 'service'
           AND (oi.product_type = 'machine' OR LOWER(oi.product_name) LIKE '%machine%'
                OR LOWER(oi.product_name) LIKE '%forfait%' OR oi.product_id LIKE 'pack-%'
                OR oi.product_id LIKE 'forfait-%')
         ORDER BY o.created_at DESC`, [accountId]);
            const machines = serializeBigInt(result.rows);
            return { machines, total: machines.length };
        }
        finally {
            client.release();
        }
    }
    // ── GET /api/orders/spending
    async getUserSpending(accountId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const [ordersRes, currencyRes] = await Promise.all([
                client.query(`SELECT COALESCE(SUM(total), 0) as orders_total FROM orders WHERE account_id = $1 AND status != 'cancelled'`, [accountId]),
                client.query(`SELECT UPPER(COALESCE(currency_code,'RON')) as currency_code, COUNT(*)::int as order_count,
                  COALESCE(SUM(charged_total),0) as charged_total, COALESCE(SUM(total),0) as ron_equivalent_total
           FROM orders WHERE account_id = $1 AND status != 'cancelled'
           GROUP BY UPPER(COALESCE(currency_code,'RON')) ORDER BY ron_equivalent_total DESC`, [accountId]),
            ]);
            const ordersTotal = Number(ordersRes.rows[0]?.orders_total) || 0;
            const totalRon = currencyRes.rows.reduce((s, r) => s + (Number(r.ron_equivalent_total) || 0), 0);
            const usage = currencyRes.rows.map((r) => ({
                currencyCode: r.currency_code, orderCount: Number(r.order_count),
                chargedTotal: Number(r.charged_total), ronEquivalentTotal: Number(r.ron_equivalent_total),
                percentage: totalRon > 0 ? Math.round((Number(r.ron_equivalent_total) / totalRon) * 10000) / 100 : 0,
            }));
            return {
                spending: { orders: ordersTotal, total: ordersTotal },
                currency: { preferredCurrency: usage[0]?.currencyCode || "RON", totalOrders: usage.reduce((s, r) => s + r.orderCount, 0), multiCurrency: usage.length > 1, usage },
            };
        }
        finally {
            client.release();
        }
    }
    // ── GET /api/orders/capsule-stats
    async getCapsuleStats(accountId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const [totalRes, ordersCountRes] = await Promise.all([
                client.query(`SELECT COALESCE(SUM(oi.quantity), 0) as total_sleeves FROM order_items oi
           JOIN orders o ON oi.order_id = o.id
           WHERE o.account_id = $1 AND o.status != 'cancelled' AND oi.product_type = 'capsule'`, [accountId]),
                client.query(`SELECT COUNT(*) as total_orders FROM orders WHERE account_id = $1 AND status != 'cancelled'`, [accountId]),
            ]);
            const totalCapsules = (Number(totalRes.rows[0]?.total_sleeves) || 0) * 10;
            const totalOrders = Number(ordersCountRes.rows[0]?.total_orders) || 0;
            let currentTier = "None";
            for (const threshold of TIER_THRESHOLDS) {
                if (totalCapsules >= threshold.min) {
                    currentTier = threshold.tier;
                    break;
                }
            }
            return {
                totalCapsules, totalOrders, currentTier,
                discountPercent: TIER_DISCOUNTS[currentTier] ?? 0,
                tierThresholds: TIER_THRESHOLDS,
            };
        }
        finally {
            client.release();
        }
    }
    // ── GET /api/orders
    async getUserOrders(accountId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT o.id, o.order_number, o.status, o.total, o.subtotal, o.discount_amount,
                o.shipping_cost, o.tax, o.currency_code, o.charged_total, o.payment_method,
                o.shipping_address, o.created_at, o.updated_at
         FROM orders o WHERE o.account_id = $1 ORDER BY o.created_at DESC`, [accountId]);
            return { orders: serializeBigInt(result.rows) };
        }
        finally {
            client.release();
        }
    }
    // ── GET /api/orders/:id
    async getOrder(accountId, orderId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const orderResult = await client.query(`SELECT o.*, a.email FROM orders o JOIN accounts a ON a.id = o.account_id
         WHERE o.id = $1 AND (o.account_id = $2 OR $3 = TRUE)`, [orderId, accountId, false]);
            const order = orderResult.rows[0];
            if (!order)
                throw new common_1.NotFoundException({ error: "Order not found" });
            const itemsResult = await client.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [orderId]);
            return { order: serializeBigInt(order), items: serializeBigInt(itemsResult.rows) };
        }
        finally {
            client.release();
        }
    }
    // ── POST /api/orders
    async createOrder(accountId, body) {
        const items = body["items"];
        if (!Array.isArray(items) || items.length === 0) {
            throw new common_1.BadRequestException({ error: "items array is required" });
        }
        // Phase 6.2: the request is now only a *wish list*. Product identity and quantity
        // are the only things taken from it; price, stock, name and shipping all come from
        // the database. Previously every one of those was read off the body, which made the
        // checkout total whatever the client said it was.
        const requested = [];
        for (const item of items) {
            const productId = String(item["productId"] ?? item["product_id"] ?? "").trim();
            if (!productId || productId.length > 128) {
                throw new common_1.BadRequestException({ error: "each item needs a productId" });
            }
            const quantity = Number(item["quantity"] ?? 1);
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
                throw new common_1.BadRequestException({
                    error: "quantity must be a whole number between 1 and 99",
                    productId,
                });
            }
            requested.push({ productId, quantity });
        }
        // The catalogue holds a single unconverted price per product, so an order can only
        // be totalled honestly in that currency. Orders in the table already carry RON, CHF,
        // PLN, CZK, DKK and TRY against identical numbers, which means those totals were
        // never converted. Refusing non-RON is deliberate: silently labelling a RON number
        // "CHF" is the worse failure. Restoring multi-currency needs an FX table, which is
        // a separate decision.
        const requestedCurrency = String(body["currencyCode"] || body["currency_code"] || "RON")
            .trim()
            .toUpperCase();
        if (requestedCurrency !== CATALOGUE_CURRENCY) {
            throw new common_1.BadRequestException({
                error: `unsupported currency ${requestedCurrency}`,
                supported: [CATALOGUE_CURRENCY],
            });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            // Get user tier
            const tierResult = await client.query("SELECT current_tier FROM member_status WHERE account_id = $1 LIMIT 1", [accountId]).catch(() => ({ rows: [] }));
            const tier = String(tierResult.rows[0]?.["current_tier"] || "None");
            const discountPct = TIER_DISCOUNTS[tier] ?? 0;
            const freeShipping = FREE_SHIPPING_TIERS.includes(tier);
            // ---- Phase 6.2: authoritative prices, with the stock rows locked ----
            //
            // FOR UPDATE serialises concurrent checkouts for the same product, so two
            // customers cannot both pass the stock check and drive it negative. Two queries
            // rather than one UNION ALL because Postgres forbids FOR UPDATE on a UNION.
            const productIds = requested.map((r) => r.productId);
            const catalogue = new Map();
            const coffeeRows = await client.query(`SELECT product_id, name, price, stock FROM coffee_products
          WHERE product_id = ANY($1::text[]) FOR UPDATE`, [productIds]);
            for (const row of coffeeRows.rows) {
                catalogue.set(String(row.product_id), {
                    name: String(row.name ?? ""),
                    price: Number(row.price),
                    stock: Number(row.stock ?? 0),
                    image: null,
                });
            }
            const machineRows = await client.query(`SELECT product_id, name, price, stock, image FROM machine_products
          WHERE product_id = ANY($1::text[]) FOR UPDATE`, [productIds]);
            for (const row of machineRows.rows) {
                catalogue.set(String(row.product_id), {
                    name: String(row.name ?? ""),
                    price: Number(row.price),
                    stock: Number(row.stock ?? 0),
                    image: row.image ? String(row.image) : null,
                });
            }
            // Images are only persisted when the catalogue itself holds a usable path, which
            // today means machine_products. Capsule paths cannot be rebuilt from
            // coffee_products: the public path needs a sub-collection segment ("Vertuo/Barista
            // Creation") that the catalogue does not store, and popular_products_cache -- the
            // only other source -- is off limits to the application role *and* covers 12 of 100
            // products, so it is not a catalogue.
            //
            // Null is the correct answer rather than the client's string: Cart.tsx already
            // resolves a missing image from product_id via getProductImageForId. Persisting a
            // caller-supplied path instead would mean an order record could name an arbitrary
            // path on the site. The real fix is an image_path column on coffee_products.
            // ---- Price from the catalogue ----
            let subtotal = 0;
            const priced = [];
            for (const { productId, quantity } of requested) {
                const row = catalogue.get(productId);
                if (!row) {
                    // Unknown product. Previously this created an order row with a client-supplied
                    // price for something that may not exist at all.
                    throw new common_1.ConflictException({
                        error: "PRODUCT_NOT_FOUND",
                        productId,
                        message: "One of the items is no longer available.",
                    });
                }
                if (!Number.isFinite(row.price) || row.price < 0) {
                    throw new common_1.ConflictException({
                        error: "PRODUCT_UNPRICED",
                        productId,
                        message: "One of the items has no valid price.",
                    });
                }
                if (row.stock < quantity) {
                    throw new common_1.ConflictException({
                        error: "INSUFFICIENT_STOCK",
                        productId,
                        available: row.stock,
                        message: row.stock === 0
                            ? "One of the items is out of stock."
                            : `Only ${row.stock} left of one of the items.`,
                    });
                }
                const totalPrice = roundMoney(row.price * quantity);
                subtotal = roundMoney(subtotal + totalPrice);
                priced.push({
                    productId,
                    name: row.name,
                    image: row.image,
                    quantity,
                    unitPrice: row.price,
                    totalPrice,
                    productType: productTypeFor(productId, items),
                });
            }
            const discountAmount = roundMoney((subtotal * discountPct) / 100);
            // Shipping was previously whatever the client posted. There is no server-side
            // shipping table, so this is now an explicit configured rate -- see
            // SHIPPING_FLAT_RON, which must match the real carrier cost.
            const shippingCost = freeShipping ? 0 : SHIPPING_FLAT_RON;
            const total = roundMoney(Math.max(0, subtotal - discountAmount + shippingCost));
            // Phase 6.1: sequence-backed, so two checkouts in the same millisecond cannot
            // collide. The UNIQUE constraint on orders.order_number remains the backstop.
            const seqResult = await client.query("SELECT nextval('orders_order_number_seq')::bigint AS seq");
            const seq = String(seqResult.rows[0]?.seq ?? "0").padStart(8, "0");
            const orderNumber = `ORD-${seq}`;
            serviceContracts.assertServiceContract("order_create_v1", { accountId, orderNumber, subtotal, total });
            const orderResult = await client.query(`INSERT INTO orders (account_id, order_number, status, subtotal, discount_amount, shipping_cost,
                tax, total, payment_method, shipping_address, billing_address, currency_code)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`, [
                accountId, orderNumber, subtotal, discountAmount, shippingCost, 0, total,
                body["paymentMethod"] || body["payment_method"] || "",
                JSON.stringify(normalizeAddress(body["shippingAddress"] ?? body["shipping_address"])),
                JSON.stringify(normalizeAddress(body["billingAddress"] ?? body["billing_address"])),
                CATALOGUE_CURRENCY,
            ]);
            const order = orderResult.rows[0];
            // ---- Phase 6.3: one statement for all items, not one per item ----
            //
            // N awaited inserts was N round-trips on the same connection inside an open
            // transaction. unnest() does it in one.
            await client.query(`INSERT INTO order_items
           (order_id, product_id, product_name, product_image, product_type, quantity, unit_price, total_price)
         SELECT $1, p.product_id, p.name, p.image, p.product_type, p.quantity, p.unit_price, p.total_price
           FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::numeric[], $8::numeric[])
                AS p(product_id, name, image, product_type, quantity, unit_price, total_price)`, [
                order["id"],
                priced.map((p) => p.productId),
                priced.map((p) => p.name),
                priced.map((p) => p.image),
                priced.map((p) => p.productType),
                priced.map((p) => p.quantity),
                priced.map((p) => p.unitPrice),
                priced.map((p) => p.totalPrice),
            ]);
            // ---- Decrement stock, now that the order exists ----
            //
            // Guarded on `stock >= quantity` as well as relying on the FOR UPDATE lock: the
            // predicate means the row count is a real assertion rather than a formality.
            for (const p of priced) {
                const updated = await client.query(`UPDATE coffee_products SET stock = stock - $1, updated_at = NOW()
            WHERE product_id = $2 AND stock >= $1`, [p.quantity, p.productId]);
                if (Number(updated.rowCount) === 0) {
                    const fallback = await client.query(`UPDATE machine_products SET stock = stock - $1, updated_at = NOW()
              WHERE product_id = $2 AND stock >= $1`, [p.quantity, p.productId]);
                    if (Number(fallback.rowCount) === 0) {
                        throw new common_1.ConflictException({
                            error: "INSUFFICIENT_STOCK",
                            productId: p.productId,
                            message: "One of the items sold out while the order was being placed.",
                        });
                    }
                }
            }
            await client.query("COMMIT");
            return { status: "success", order: serializeBigInt(order), orderNumber };
        }
        catch (e) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw e;
        }
        finally {
            client.release();
        }
    }
    // ── PUT /api/orders/:id/status
    async updateOrderStatus(requestingAccountId, orderId, newStatus, isAdmin) {
        const allowed = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];
        if (!allowed.includes(String(newStatus))) {
            throw new common_1.BadRequestException({ error: `Invalid status. Allowed: ${allowed.join(", ")}` });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const where = isAdmin ? "WHERE id = $1" : "WHERE id = $1 AND account_id = $2";
            const params = isAdmin ? [orderId] : [orderId, requestingAccountId];
            const result = await client.query(`UPDATE orders SET status = $${params.length + 1}, updated_at = NOW() ${where} RETURNING *`, [...params, newStatus]);
            if (!result.rowCount)
                throw new common_1.NotFoundException({ error: "Order not found" });
            return { status: "success", order: serializeBigInt(result.rows[0]) };
        }
        finally {
            client.release();
        }
    }
    // ── GET /api/orders/:id/invoice
    async getOrderInvoice(accountId, orderId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 AND account_id = $2 LIMIT 1", [orderId, accountId]);
            const order = orderResult.rows[0];
            if (!order)
                throw new common_1.NotFoundException({ error: "Order not found" });
            const serviceAssertion = this.createServiceAssertion("service-invoice:render");
            if (this.invoiceRequireServiceAssertion && !serviceAssertion) {
                throw new common_1.ServiceUnavailableException({ error: "Invoice service assertion required but unavailable" });
            }
            const headers = {
                "Content-Type": "application/json", Accept: "application/pdf",
                "x-service-name": "filspresso-backend",
            };
            if (serviceAssertion)
                headers["x-service-assertion"] = serviceAssertion;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const response = await fetch(`${this.invoiceServiceUrl}/api/invoices/render`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ invoiceNumber: `INV-${order["order_number"]}`, orderNumber: order["order_number"], generatedAt: new Date().toISOString() }),
                    signal: controller.signal,
                });
                if (!response.ok)
                    return null;
                return Buffer.from(await response.arrayBuffer());
            }
            finally {
                clearTimeout(timeout);
            }
        }
        finally {
            client.release();
        }
    }
    // Role check helper
    assertAdmin(user) {
        if (!user || String(user["role"] || "").toLowerCase() !== "admin") {
            throw new common_1.ForbiddenException({ error: "Admin access required" });
        }
    }
};
exports.OrdersService = OrdersService;
exports.OrdersService = OrdersService = OrdersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], OrdersService);
