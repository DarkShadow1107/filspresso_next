"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CartService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const TIER_DISCOUNTS = {
    None: 0, Connoisseur: 5, Expert: 10, Master: 15, Virtuoso: 18, Ambassador: 20,
};
const ACTIVE_CART_RESERVATION_MINUTES = Math.max(1, Number.parseInt(process.env.CART_RESERVATION_MINUTES || "20", 10));
const CART_STOCK_BUFFER_UNITS = Math.max(0, Number.parseInt(process.env.CART_STOCK_BUFFER_UNITS || "0", 10));
let CartService = class CartService {
    db;
    constructor(db) {
        this.db = db;
    }
    resolveInventoryTable(productType) {
        if (productType === "capsule")
            return "coffee_products";
        if (productType === "machine" || productType === "accessory")
            return "machine_products";
        return null;
    }
    async getStockAvailability(client, { accountId, productType, productId, lockRow }) {
        const inventoryTable = this.resolveInventoryTable(productType);
        if (!inventoryTable) {
            return { tracked: false, availableQuantity: Number.POSITIVE_INFINITY };
        }
        const stockResult = await client.query(`SELECT stock FROM ${inventoryTable} WHERE product_id = $1${lockRow ? " FOR UPDATE" : ""}`, [productId]);
        if (!stockResult.rows[0]) {
            return { tracked: true, missingProduct: true, availableQuantity: 0 };
        }
        const stock = Number(stockResult.rows[0].stock) || 0;
        const reservedResult = await client.query(`SELECT COALESCE(SUM(quantity), 0) AS reserved_qty
       FROM cart_items
       WHERE product_type = $1 AND product_id = $2 AND account_id != $3
         AND updated_at >= NOW() - ($4::text || ' minutes')::interval`, [productType, productId, accountId, ACTIVE_CART_RESERVATION_MINUTES]);
        const reservedByOthers = Number(reservedResult.rows[0]?.reserved_qty) || 0;
        const availableQuantity = Math.max(0, stock - reservedByOthers - CART_STOCK_BUFFER_UNITS);
        return { tracked: true, stock, reservedByOthers, bufferUnits: CART_STOCK_BUFFER_UNITS, availableQuantity };
    }
    async getUserTier(client, accountId) {
        try {
            try {
                const r = await client.query("SELECT current_tier FROM member_status WHERE account_id = $1", [accountId]);
                if (r.rows[0]?.current_tier)
                    return String(r.rows[0].current_tier);
            }
            catch (e) {
                if (e.code !== "42P01")
                    throw e;
            }
            const ar = await client.query("SELECT created_at FROM accounts WHERE id = $1", [accountId]);
            if (!ar.rows[0])
                return "None";
            const accountCreated = new Date(ar.rows[0].created_at);
            const now = new Date();
            let periodStart = new Date(accountCreated);
            while (periodStart <= now) {
                const next = new Date(periodStart);
                next.setFullYear(next.getFullYear() + 1);
                if (next > now)
                    break;
                periodStart = next;
            }
            const cr = await client.query(`SELECT COALESCE(SUM(oi.quantity), 0) as total_sleeves
         FROM orders o JOIN order_items oi ON o.id = oi.order_id
         WHERE o.account_id = $1 AND o.created_at >= $2 AND oi.product_type = 'capsule'`, [accountId, periodStart.toISOString()]);
            const total = (Number(cr.rows[0]?.total_sleeves) || 0) * 10;
            if (total >= 7000)
                return "Ambassador";
            if (total >= 4000)
                return "Virtuoso";
            if (total >= 2000)
                return "Master";
            if (total >= 750)
                return "Expert";
            if (total >= 1)
                return "Connoisseur";
            return "None";
        }
        catch {
            return "None";
        }
    }
    async getCart(accountId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT id, product_type, product_id, product_name, product_image, unit_price, quantity, created_at
         FROM cart_items WHERE account_id = $1 ORDER BY created_at DESC`, [accountId]);
            const memberTier = await this.getUserTier(client, accountId);
            const discountPercent = TIER_DISCOUNTS[memberTier] || 0;
            const items = result.rows.map((item) => ({
                id: item.id, productType: item.product_type, productId: item.product_id,
                name: item.product_name, image: item.product_image,
                price: parseFloat(String(item.unit_price)),
                quantity: item.quantity,
                totalPrice: parseFloat(String(item.unit_price)) * Number(item.quantity),
            }));
            const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
            const discountAmount = Math.round(subtotal * (discountPercent / 100) * 100) / 100;
            return { items, subtotal, itemCount: items.reduce((s, i) => s + i.quantity, 0), memberTier, discountPercent, discountAmount, subtotalAfterDiscount: subtotal - discountAmount };
        }
        finally {
            client.release();
        }
    }
    async addItem(accountId, body) {
        const { productType, productId, productName, productImage, unitPrice, quantity = 1 } = body;
        const normalizedQty = Number.parseInt(String(quantity), 10);
        if (!productType || !productId || !productName || unitPrice === undefined) {
            throw new common_1.BadRequestException({ error: "Product type, ID, name and price are required" });
        }
        if (!["capsule", "machine", "accessory"].includes(String(productType))) {
            throw new common_1.BadRequestException({ error: "Invalid product type" });
        }
        if (!Number.isInteger(normalizedQty) || normalizedQty < 1) {
            throw new common_1.BadRequestException({ error: "Quantity must be an integer of at least 1" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const existing = await client.query("SELECT id, quantity FROM cart_items WHERE account_id = $1 AND product_type = $2 AND product_id = $3", [accountId, productType, productId]);
            const existingRow = existing.rows[0];
            const targetQty = existingRow ? Number(existingRow.quantity) + normalizedQty : normalizedQty;
            const availability = await this.getStockAvailability(client, { accountId, productType: String(productType), productId: String(productId), lockRow: true });
            if (availability.missingProduct) {
                await client.query("ROLLBACK");
                throw new common_1.NotFoundException({ error: "Product not found in stock inventory" });
            }
            if (availability.tracked && targetQty > availability.availableQuantity) {
                await client.query("ROLLBACK");
                throw new common_1.ConflictException({ error: `Only ${availability.availableQuantity} units currently available.`, availableQuantity: availability.availableQuantity, requestedQuantity: targetQty });
            }
            if (existingRow) {
                await client.query("UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2", [targetQty, existingRow.id]);
                await client.query("COMMIT");
                return { message: "Cart updated", quantity: targetQty };
            }
            await client.query("INSERT INTO cart_items (account_id, product_type, product_id, product_name, product_image, unit_price, quantity) VALUES ($1, $2, $3, $4, $5, $6, $7)", [accountId, productType, productId, productName, productImage || null, unitPrice, normalizedQty]);
            await client.query("COMMIT");
            return { message: "Item added to cart" };
        }
        catch (e) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw e;
        }
        finally {
            client.release();
        }
    }
    async updateItem(accountId, itemId, quantity) {
        const normalizedQty = Number.parseInt(String(quantity), 10);
        if (!Number.isInteger(normalizedQty) || normalizedQty < 1) {
            throw new common_1.BadRequestException({ error: "Quantity must be an integer of at least 1" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query("SELECT id, product_type, product_id FROM cart_items WHERE id = $1 AND account_id = $2", [itemId, accountId]);
            const item = result.rows[0];
            if (!item) {
                await client.query("ROLLBACK");
                throw new common_1.NotFoundException({ error: "Cart item not found" });
            }
            const availability = await this.getStockAvailability(client, { accountId, productType: String(item.product_type), productId: String(item.product_id), lockRow: true });
            if (availability.missingProduct) {
                await client.query("ROLLBACK");
                throw new common_1.NotFoundException({ error: "Product not found in stock inventory" });
            }
            if (availability.tracked && normalizedQty > availability.availableQuantity) {
                await client.query("ROLLBACK");
                throw new common_1.ConflictException({ error: `Only ${availability.availableQuantity} units available.`, availableQuantity: availability.availableQuantity });
            }
            await client.query("UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2", [normalizedQty, itemId]);
            await client.query("COMMIT");
            return { message: "Cart updated" };
        }
        catch (e) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw e;
        }
        finally {
            client.release();
        }
    }
    async removeItem(accountId, itemId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query("SELECT id FROM cart_items WHERE id = $1 AND account_id = $2", [itemId, accountId]);
            if (!result.rows[0])
                throw new common_1.NotFoundException({ error: "Cart item not found" });
            await client.query("DELETE FROM cart_items WHERE id = $1", [itemId]);
            return { message: "Item removed from cart" };
        }
        finally {
            client.release();
        }
    }
    async clearCart(accountId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("DELETE FROM cart_items WHERE account_id = $1", [accountId]);
            return { message: "Cart cleared" };
        }
        finally {
            client.release();
        }
    }
};
exports.CartService = CartService;
exports.CartService = CartService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], CartService);
