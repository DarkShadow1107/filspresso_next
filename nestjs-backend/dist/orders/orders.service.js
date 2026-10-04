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
const fx_rates_service_1 = require("./fx-rates.service");
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
 * Shipping: a flat rate below a threshold, free at or above it.
 *
 * There is no server-side shipping table anywhere, and shipping used to come straight
 * from the request body -- so a client could post any rate it liked, including zero.
 *
 * Both numbers are configuration rather than constants because they are business facts
 * about the carrier, not facts about the code.
 */
const SHIPPING_FLAT_RON = readMoneyEnv("SHIPPING_FLAT_RON", 24.99);
const SHIPPING_FREE_ABOVE_RON = readMoneyEnv("SHIPPING_FREE_ABOVE_RON", 200);
/** Parse a non-negative money setting, falling back when unset or nonsensical. */
function readMoneyEnv(name, fallback) {
    const raw = Number.parseFloat(String(process.env[name] ?? ""));
    return Number.isFinite(raw) && raw >= 0 ? roundMoney(raw) : fallback;
}
/**
 * Shipping for one order, in RON.
 *
 * `merchandiseTotal` is the discounted goods total: the threshold is about how big the
 * basket is, and the discount is what the customer is actually paying for the goods.
 * Tier members with free shipping included (FREE_SHIPPING_TIERS) skip the charge
 * entirely, which is a separate rule from the threshold.
 */
function shippingCostForRon(merchandiseTotal, freeShippingTier) {
    if (freeShippingTier)
        return 0;
    return merchandiseTotal >= SHIPPING_FREE_ABOVE_RON ? 0 : SHIPPING_FLAT_RON;
}
/** Money is rounded to minor units at every step, never accumulated as a float. */
function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
/**
 * Normalise a destination country to ISO-3166 alpha-2, uppercased.
 *
 * Stored on the order for the shipping region and for dispute resolution. Anything not
 * two letters becomes null rather than being stored as-is, so this column cannot become
 * a free-text dumping ground.
 */
function normalizeCountry(value) {
    if (typeof value !== "string")
        return null;
    const code = value.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : null;
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
 * Name of the unique index behind idempotency, as Postgres reports it on a 23505.
 *
 * Kept as a constant because it has to agree with the migration, and the two live in
 * different files. `test/order-idempotency.test.ts` asserts they still match.
 */
const IDEMPOTENCY_UNIQUE_INDEX = "idx_orders_account_idempotency_key";
/**
 * True when `error` is a Postgres unique violation (SQLSTATE 23505) on `constraint`.
 *
 * Checked by constraint name rather than by message text, so it cannot be fooled by a
 * product name that happens to contain the words.
 */
function isUniqueViolation(error, constraint) {
    const code = error?.code;
    if (code !== "23505")
        return false;
    const name = error?.constraint;
    return name === constraint;
}
/**
 * Absolute origin the invoice renderer uses to resolve site-relative image paths.
 *
 * The renderer is a separate service and cannot fetch `/images/...`. Falls back to empty
 * rather than guessing a host: a wrong absolute URL would render a broken image, whereas
 * an empty one lets the renderer omit the image and still produce a valid invoice.
 */
function resolveAssetBaseUrl() {
    const raw = String(process.env.INVOICE_ASSET_BASE_URL ?? process.env.FRONTEND_ORIGIN ?? "").trim();
    if (!raw)
        return "";
    return raw.replace(/\/+$/, "");
}
/**
 * Normalise a catalogue image path for storage on an order line.
 *
 * Everything is stored site-rooted and same-origin. An absolute URL would make an order
 * record -- and any invoice rendered from it -- point at whatever host a catalogue row
 * happened to name, so anything with a scheme or a leading `//` is dropped rather than
 * sanitised into something that looks trusted.
 */
function normalizeImagePath(value) {
    if (typeof value !== "string")
        return null;
    let path = value.trim().replace(/\\/g, "/");
    if (!path || path.length > 512)
        return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//"))
        return null;
    if (!path.startsWith("/"))
        path = `/${path}`;
    return path.includes("..") ? null : path;
}
/**
 * Normalise an `Idempotency-Key` header into something safe to store and compare.
 *
 * Returns null for an absent key, and for a present-but-unusable one -- the caller
 * distinguishes those two, because a malformed key is a client error worth reporting
 * while an absent key is simply the old non-idempotent behaviour.
 */
function normalizeIdempotencyKey(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    if (!/^[A-Za-z0-9._:-]+$/.test(trimmed))
        return null;
    return trimmed;
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
    fx;
    logger = new common_1.Logger(OrdersService_1.name);
    assertionPrivateKey;
    assertionIssuer;
    assertionSubject;
    assertionTtlSeconds;
    invoiceServiceUrl;
    invoiceRequireServiceAssertion;
    constructor(db, fx) {
        this.db = db;
        this.fx = fx;
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
    /**
     * Read back the stored response for a key, on its own connection.
     *
     * Used by the conflict path, where the transaction that lost has already rolled back
     * and cannot serve the read.
     */
    async replayStoredResponse(accountId, key) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const { rows } = await client.query("SELECT response FROM orders WHERE account_id = $1 AND idempotency_key = $2 LIMIT 1", [accountId, key]);
            const stored = rows[0];
            if (!stored)
                return null;
            const replayed = stored.response;
            return {
                replayed: true,
                ...(typeof replayed === "object" && replayed !== null ? replayed : { order: replayed }),
            };
        }
        catch {
            return null;
        }
        finally {
            client.release();
        }
    }
    /**
     * `idempotencyKey` is the caller's `Idempotency-Key` header, if any.
     *
     * Phase 6.4: a retry after a dropped response must not create a second order. When a
     * key is supplied and has been seen before for this account, the stored response is
     * replayed verbatim and nothing is inserted. Omitting the key keeps the previous
     * behaviour, so this is opt-in per client rather than a breaking change.
     */
    async createOrder(accountId, body, idempotencyKey) {
        const items = body["items"];
        if (!Array.isArray(items) || items.length === 0) {
            throw new common_1.BadRequestException({ error: "items array is required" });
        }
        // Bounded and character-restricted: this value is stored, so it must not be free
        // storage and must not smuggle anything odd into logs or error messages.
        const key = normalizeIdempotencyKey(idempotencyKey);
        const keySupplied = idempotencyKey !== undefined && idempotencyKey !== null && idempotencyKey !== "";
        if (keySupplied && !key) {
            throw new common_1.BadRequestException({
                error: "invalid Idempotency-Key",
                expected: "1-128 characters from [A-Za-z0-9._:-]",
            });
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
        // ---- Multi-currency ----
        //
        // The catalogue prices everything in RON; `currency_code` is what the *customer* is
        // charged in. The rate is resolved here, server-side, before the transaction opens,
        // for two reasons: a rate taken from the request is a rate the caller chooses, and a
        // network call inside a transaction would hold a pooled connection for the duration.
        const requestedCurrency = String(body["currencyCode"] || body["currency_code"] || "RON")
            .trim()
            .toUpperCase();
        if (!this.fx.supports(requestedCurrency)) {
            throw new common_1.BadRequestException({
                error: `unsupported currency ${requestedCurrency}`,
                supported: Object.keys(fx_rates_service_1.CURRENCY_FEE_PERCENT),
            });
        }
        const destinationCountry = normalizeCountry(body["destinationCountry"] ?? body["destination_country"]);
        const fx = await this.fx.resolve(requestedCurrency);
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            // ---- Phase 6.4: replay a previous result for this key ----
            //
            // Inside the transaction, before anything is written. The unique index on
            // (account_id, idempotency_key) is what actually makes this safe: two concurrent
            // retries can both miss this SELECT, and exactly one of them wins the INSERT.
            if (key) {
                const prior = await client.query(`SELECT id, response FROM orders
            WHERE account_id = $1 AND idempotency_key = $2 LIMIT 1`, [accountId, key]);
                const stored = prior.rows[0];
                if (stored) {
                    await client.query("COMMIT");
                    const replayed = stored.response;
                    return {
                        // Flagged so a client can tell a replay from a fresh creation without
                        // having to diff the response body.
                        replayed: true,
                        ...(typeof replayed === "object" && replayed !== null
                            ? replayed
                            : { order: replayed }),
                    };
                }
            }
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
            const coffeeRows = await client.query(`SELECT product_id, name, price, stock, image_path FROM coffee_products
          WHERE product_id = ANY($1::text[]) FOR UPDATE`, [productIds]);
            for (const row of coffeeRows.rows) {
                catalogue.set(String(row.product_id), {
                    name: String(row.name ?? ""),
                    price: Number(row.price),
                    stock: Number(row.stock ?? 0),
                    image: normalizeImagePath(row.image_path),
                });
            }
            const machineRows = await client.query(`SELECT product_id, name, price, stock, image FROM machine_products
          WHERE product_id = ANY($1::text[]) FOR UPDATE`, [productIds]);
            for (const row of machineRows.rows) {
                catalogue.set(String(row.product_id), {
                    name: String(row.name ?? ""),
                    price: Number(row.price),
                    stock: Number(row.stock ?? 0),
                    image: normalizeImagePath(row.image),
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
            const shippingCost = shippingCostForRon(subtotal - discountAmount, freeShipping);
            const total = roundMoney(Math.max(0, subtotal - discountAmount + shippingCost));
            // What the customer is actually charged, in their currency.
            //
            // Each component is rounded separately rather than converting the total once: the
            // fee is a percentage of the *converted* subtotal, so rounding order is visible in
            // the final figure and has to match the invoice.
            const chargedSubtotal = roundMoney(subtotal * fx.rate);
            const chargedShipping = roundMoney(shippingCost * fx.rate);
            const chargedTax = roundMoney(0 * fx.rate);
            const conversionFee = roundMoney((chargedSubtotal * fx.feePercent) / 100);
            const chargedTotal = roundMoney(chargedSubtotal + chargedShipping + chargedTax + conversionFee);
            // Phase 6.1: sequence-backed, so two checkouts in the same millisecond cannot
            // collide. The UNIQUE constraint on orders.order_number remains the backstop.
            const seqResult = await client.query("SELECT nextval('orders_order_number_seq')::bigint AS seq");
            const seq = String(seqResult.rows[0]?.seq ?? "0").padStart(8, "0");
            const orderNumber = `ORD-${seq}`;
            serviceContracts.assertServiceContract("order_create_v1", { accountId, orderNumber, subtotal, total });
            const orderResult = await client.query(`INSERT INTO orders (account_id, order_number, status, subtotal, discount_amount, shipping_cost,
                tax, total, payment_method, shipping_address, billing_address, currency_code,
                idempotency_key, response, exchange_rate, conversion_fee_percent,
                charged_subtotal, charged_shipping_cost, charged_tax, charged_total,
                destination_country)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '{}'::jsonb,
                 $13, $14, $15, $16, $17, $18, $19)
         RETURNING *`, [
                accountId, orderNumber, subtotal, discountAmount, shippingCost, 0, total,
                body["paymentMethod"] || body["payment_method"] || "",
                JSON.stringify(normalizeAddress(body["shippingAddress"] ?? body["shipping_address"])),
                JSON.stringify(normalizeAddress(body["billingAddress"] ?? body["billing_address"])),
                fx.currency,
                key,
                fx.rate,
                fx.feePercent,
                chargedSubtotal,
                chargedShipping,
                chargedTax,
                chargedTotal,
                destinationCountry,
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
            const response = {
                status: "success",
                order: serializeBigInt(order),
                orderNumber,
                // Echoed so the client can show the rate it was charged at without a second call.
                fx: {
                    currency: fx.currency,
                    rate: fx.rate,
                    date: fx.date,
                    source: fx.source,
                    stale: fx.stale,
                    feePercent: fx.feePercent,
                },
            };
            // ---- Phase 6.4: store the response so a retry can be replayed ----
            //
            // Written inside the transaction, and only when a key was supplied. Without a key
            // there is nothing to look the response up by, and storing it would just be a copy
            // of data already in the orders and order_items tables.
            if (key) {
                await client.query("UPDATE orders SET response = $1::jsonb WHERE id = $2", [JSON.stringify(response), order["id"]]);
            }
            await client.query("COMMIT");
            return response;
        }
        catch (e) {
            await client.query("ROLLBACK").catch(() => undefined);
            // The unique index is the real guarantee. If two concurrent retries both missed
            // the replay SELECT, the loser's INSERT violates (account_id, idempotency_key).
            // That is a replay, not a failure, so re-read the winner's response and return it
            // rather than surfacing a 500 for what is, to the client, the same request.
            // The name must match the object Postgres actually reports. This is a unique *index*
            // (idx_orders_account_idempotency_key), and for an index violation pg reports the
            // index name in err.constraint -- not a constraint name.
            if (key && isUniqueViolation(e, IDEMPOTENCY_UNIQUE_INDEX)) {
                const winner = await this.replayStoredResponse(accountId, key);
                if (winner)
                    return winner;
            }
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
    /**
     * Render an order's invoice via the Java invoice service.
     *
     * Phase 7.2: the connection is released before the HTTP call. Rendering is a CPU-bound
     * job in another process that can take seconds; holding a pooled connection across it
     * meant a handful of concurrent invoice requests could exhaust the pool while no
     * database work was happening at all.
     */
    async getOrderInvoice(accountId, orderId) {
        const pool = this.db.getPool();
        let client = await pool.connect();
        try {
            const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 AND account_id = $2 LIMIT 1", [orderId, accountId]);
            const order = orderResult.rows[0];
            if (!order)
                throw new common_1.NotFoundException({ error: "Order not found" });
            const serviceAssertion = this.createServiceAssertion("service-invoice:render");
            if (this.invoiceRequireServiceAssertion && !serviceAssertion) {
                throw new common_1.ServiceUnavailableException({ error: "Invoice service assertion required but unavailable" });
            }
            // The line items were never sent. `validateInvoiceRenderRequestV1` requires
            // `items`, so the renderer has been producing an invoice with no products on it,
            // and the contract was never called so nothing noticed. The image is the
            // catalogue path relative to `assetBaseUrl`, because a renderer cannot fetch a
            // site-relative path.
            const itemsResult = await client.query(`SELECT product_name, product_image, quantity, unit_price, total_price
           FROM order_items WHERE order_id = $1 ORDER BY id`, [orderId]);
            const assetBaseUrl = resolveAssetBaseUrl();
            const invoiceItems = itemsResult.rows.map((row) => ({
                name: String(row.product_name ?? ""),
                quantity: Number(row.quantity ?? 0),
                unitPrice: Number(row.unit_price ?? 0),
                totalPrice: Number(row.total_price ?? 0),
                ...(normalizeImagePath(row.product_image)
                    ? {
                        image: normalizeImagePath(row.product_image),
                        imageUrl: `${assetBaseUrl}${normalizeImagePath(row.product_image)}`,
                    }
                    : {}),
            }));
            // What the customer was charged, in their currency. An invoice that shows the RON
            // figures for a CHF order is a receipt for a different transaction.
            const invoicePayload = {
                invoiceNumber: `INV-${order["order_number"]}`,
                orderNumber: order["order_number"],
                generatedAt: new Date().toISOString(),
                items: invoiceItems,
                currencyCode: String(order["currency_code"] ?? "RON"),
                subtotal: Number(order["subtotal"] ?? 0),
                discountAmount: Number(order["discount_amount"] ?? 0),
                shippingCost: Number(order["shipping_cost"] ?? 0),
                tax: Number(order["tax"] ?? 0),
                total: Number(order["total"] ?? 0),
                exchangeRate: Number(order["exchange_rate"] ?? 1),
                conversionFeePercent: Number(order["conversion_fee_percent"] ?? 0),
                chargedSubtotal: Number(order["charged_subtotal"] ?? 0),
                chargedShippingCost: Number(order["charged_shipping_cost"] ?? 0),
                chargedTax: Number(order["charged_tax"] ?? 0),
                chargedTotal: Number(order["charged_total"] ?? 0),
                assetBaseUrl,
            };
            // Asserted, so a future change that drops `items` again fails here rather than
            // shipping a blank invoice to a customer.
            serviceContracts.assertServiceContract("invoice_render_request_v1", invoicePayload);
            // ---- Give the connection back before the network call ----
            //
            // Nothing below reads the database, so holding a slot through a multi-second
            // render would only ever hurt.
            client.release();
            client = null;
            const headers = {
                "Content-Type": "application/json", Accept: "application/pdf",
                // A PDF is already compressed, so gzipping it burns CPU on both ends to save
                // almost nothing. Identity is the cheaper correct answer.
                "Accept-Encoding": "identity",
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
                    body: JSON.stringify(invoicePayload),
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
            client?.release();
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
    __metadata("design:paramtypes", [database_service_1.DatabaseService, fx_rates_service_1.FxRatesService])
], OrdersService);
