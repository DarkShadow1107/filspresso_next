import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as serviceAssertionUtils from "../common/utils/serviceAssertions";
import * as serviceContracts from "../common/utils/serviceContracts";

const TIER_DISCOUNTS: Record<string, number> = {
  None: 0, Connoisseur: 5, Expert: 10, Master: 15, Virtuoso: 18, Ambassador: 20,
};
const TIER_THRESHOLDS = [
  { tier: "Ambassador", min: 7000 }, { tier: "Virtuoso", min: 4000 },
  { tier: "Master", min: 2000 }, { tier: "Expert", min: 750 }, { tier: "Connoisseur", min: 1 },
];
const FREE_SHIPPING_TIERS = ["Master", "Virtuoso", "Ambassador"];

function serializeBigInt(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return Number(obj);
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const key in obj as object) { result[key] = serializeBigInt((obj as Record<string, unknown>)[key]); }
    return result;
  }
  return obj;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly assertionPrivateKey: string;
  private readonly assertionIssuer: string;
  private readonly assertionSubject: string;
  private readonly assertionTtlSeconds: number;
  private readonly invoiceServiceUrl: string;
  private readonly invoiceRequireServiceAssertion: boolean;

  constructor(private readonly db: DatabaseService) {
    this.assertionPrivateKey = String(process.env.SERVICE_ASSERTION_PRIVATE_KEY || "");
    this.assertionIssuer = String(process.env.SERVICE_ASSERTION_ISSUER || "filspresso-backend");
    this.assertionSubject = String(process.env.SERVICE_ASSERTION_SUBJECT || "backend");
    this.assertionTtlSeconds = Math.min(Math.max(Number.parseInt(process.env.SERVICE_ASSERTION_TTL_SECONDS || "120", 10) || 120, 30), 600);
    this.invoiceServiceUrl = String(process.env.INVOICE_SERVICE_URL || "http://localhost:8082");
    this.invoiceRequireServiceAssertion = String(process.env.INVOICE_REQUIRE_SERVICE_ASSERTION || "true").toLowerCase() === "true";
  }

  private createServiceAssertion(scope: string): string {
    if (!this.assertionPrivateKey) return "";
    try {
      const issued = serviceAssertionUtils.issueServiceAssertion({
        privateKeyPem: this.assertionPrivateKey, issuer: this.assertionIssuer,
        subject: this.assertionSubject, scope, ttlSeconds: this.assertionTtlSeconds,
      });
      return issued.token;
    } catch (e) {
      this.logger.warn(`Failed to issue service assertion: ${e instanceof Error ? e.message : String(e)}`);
      return "";
    }
  }

  // ── GET /api/orders/popular
  async getPopularProducts(limit: number): Promise<unknown> {
    const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 5, 1), 20);
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT product_id, product_name, product_image, total_ordered
         FROM popular_products_cache
         ORDER BY total_ordered DESC LIMIT $1`,
        [safeLimit],
      );
      const products = serializeBigInt(result.rows);
      return { products, total: (products as unknown[]).length };
    } finally { client.release(); }
  }

  // ── GET /api/orders/machines
  async getUserMachines(accountId: number): Promise<unknown> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT oi.id, o.id as order_id, o.order_number, oi.product_type, oi.product_id,
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
         ORDER BY o.created_at DESC`,
        [accountId],
      );
      const machines = serializeBigInt(result.rows);
      return { machines, total: (machines as unknown[]).length };
    } finally { client.release(); }
  }

  // ── GET /api/orders/spending
  async getUserSpending(accountId: number): Promise<unknown> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const [ordersRes, currencyRes] = await Promise.all([
        client.query(`SELECT COALESCE(SUM(total), 0) as orders_total FROM orders WHERE account_id = $1 AND status != 'cancelled'`, [accountId]),
        client.query(
          `SELECT UPPER(COALESCE(currency_code,'RON')) as currency_code, COUNT(*)::int as order_count,
                  COALESCE(SUM(charged_total),0) as charged_total, COALESCE(SUM(total),0) as ron_equivalent_total
           FROM orders WHERE account_id = $1 AND status != 'cancelled'
           GROUP BY UPPER(COALESCE(currency_code,'RON')) ORDER BY ron_equivalent_total DESC`,
          [accountId],
        ),
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
    } finally { client.release(); }
  }

  // ── GET /api/orders/capsule-stats
  async getCapsuleStats(accountId: number): Promise<unknown> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const [totalRes, ordersCountRes] = await Promise.all([
        client.query(
          `SELECT COALESCE(SUM(oi.quantity), 0) as total_sleeves FROM order_items oi
           JOIN orders o ON oi.order_id = o.id
           WHERE o.account_id = $1 AND o.status != 'cancelled' AND oi.product_type = 'capsule'`,
          [accountId],
        ),
        client.query(`SELECT COUNT(*) as total_orders FROM orders WHERE account_id = $1 AND status != 'cancelled'`, [accountId]),
      ]);
      const totalCapsules = (Number(totalRes.rows[0]?.total_sleeves) || 0) * 10;
      const totalOrders = Number(ordersCountRes.rows[0]?.total_orders) || 0;
      let currentTier = "None";
      for (const threshold of TIER_THRESHOLDS) {
        if (totalCapsules >= threshold.min) { currentTier = threshold.tier; break; }
      }
      return {
        totalCapsules, totalOrders, currentTier,
        discountPercent: TIER_DISCOUNTS[currentTier] ?? 0,
        tierThresholds: TIER_THRESHOLDS,
      };
    } finally { client.release(); }
  }

  // ── GET /api/orders
  async getUserOrders(accountId: number): Promise<unknown> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT o.id, o.order_number, o.status, o.total, o.subtotal, o.discount_amount,
                o.shipping_cost, o.tax, o.currency_code, o.charged_total, o.payment_method,
                o.shipping_address, o.created_at, o.updated_at
         FROM orders o WHERE o.account_id = $1 ORDER BY o.created_at DESC`,
        [accountId],
      );
      return { orders: serializeBigInt(result.rows) };
    } finally { client.release(); }
  }

  // ── GET /api/orders/:id
  async getOrder(accountId: number, orderId: number): Promise<unknown> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const orderResult = await client.query(
        `SELECT o.*, a.email FROM orders o JOIN accounts a ON a.id = o.account_id
         WHERE o.id = $1 AND (o.account_id = $2 OR $3 = TRUE)`,
        [orderId, accountId, false],
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException({ error: "Order not found" });
      const itemsResult = await client.query(
        "SELECT * FROM order_items WHERE order_id = $1 ORDER BY id",
        [orderId],
      );
      return { order: serializeBigInt(order), items: serializeBigInt(itemsResult.rows) };
    } finally { client.release(); }
  }

  // ── POST /api/orders
  async createOrder(accountId: number, body: Record<string, unknown>): Promise<unknown> {
    const items = body["items"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException({ error: "items array is required" });
    }
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Get user tier
      const tierResult = await client.query(
        "SELECT current_tier FROM member_status WHERE account_id = $1 LIMIT 1", [accountId],
      ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
      const tier = String(tierResult.rows[0]?.["current_tier"] || "None");
      const discountPct = TIER_DISCOUNTS[tier] ?? 0;
      const freeShipping = FREE_SHIPPING_TIERS.includes(tier);

      // Calculate subtotal from items
      let subtotal = 0;
      for (const item of items) {
        const price = Number(item["unitPrice"] || item["unit_price"] || 0);
        const qty = Number(item["quantity"] || 1);
        subtotal += price * qty;
      }
      const discountAmount = Math.round(subtotal * (discountPct / 100) * 100) / 100;
      const shippingCost = freeShipping ? 0 : Number(body["shippingCost"] || body["shipping_cost"] || 0);
      const total = Math.max(0, subtotal - discountAmount + shippingCost);

      const orderNumber = `ORD-${Date.now()}`;
      serviceContracts.assertServiceContract("order_create_v1", { accountId, orderNumber, subtotal, total });

      const orderResult = await client.query(
        `INSERT INTO orders (account_id, order_number, status, subtotal, discount_amount, shipping_cost,
                tax, total, payment_method, shipping_address, billing_address, currency_code)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          accountId, orderNumber, subtotal, discountAmount, shippingCost, 0, total,
          body["paymentMethod"] || body["payment_method"] || "",
          body["shippingAddress"] || body["shipping_address"] || "",
          body["billingAddress"] || body["billing_address"] || "",
          body["currencyCode"] || body["currency_code"] || "RON",
        ],
      );
      const order = orderResult.rows[0] as Record<string, unknown>;

      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, product_image, product_type, quantity, unit_price, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            order["id"], item["productId"] || item["product_id"],
            item["productName"] || item["product_name"] || "",
            item["productImage"] || item["product_image"] || null,
            item["productType"] || item["product_type"] || "capsule",
            Number(item["quantity"] || 1), Number(item["unitPrice"] || item["unit_price"] || 0),
            Number(item["totalPrice"] || item["total_price"] || 0),
          ],
        );
      }
      await client.query("COMMIT");
      return { status: "success", order: serializeBigInt(order), orderNumber };
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  }

  // ── PUT /api/orders/:id/status
  async updateOrderStatus(requestingAccountId: number, orderId: number, newStatus: string, isAdmin: boolean): Promise<unknown> {
    const allowed = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];
    if (!allowed.includes(String(newStatus))) {
      throw new BadRequestException({ error: `Invalid status. Allowed: ${allowed.join(", ")}` });
    }
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const where = isAdmin ? "WHERE id = $1" : "WHERE id = $1 AND account_id = $2";
      const params: unknown[] = isAdmin ? [orderId] : [orderId, requestingAccountId];
      const result = await client.query(
        `UPDATE orders SET status = $${params.length + 1}, updated_at = NOW() ${where} RETURNING *`,
        [...params, newStatus],
      );
      if (!result.rowCount) throw new NotFoundException({ error: "Order not found" });
      return { status: "success", order: serializeBigInt(result.rows[0]) };
    } finally { client.release(); }
  }

  // ── GET /api/orders/:id/invoice
  async getOrderInvoice(accountId: number, orderId: number): Promise<Buffer | null> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const orderResult = await client.query(
        "SELECT * FROM orders WHERE id = $1 AND account_id = $2 LIMIT 1",
        [orderId, accountId],
      );
      const order = orderResult.rows[0] as Record<string, unknown> | undefined;
      if (!order) throw new NotFoundException({ error: "Order not found" });

      const serviceAssertion = this.createServiceAssertion("service-invoice:render");
      if (this.invoiceRequireServiceAssertion && !serviceAssertion) {
        throw new ServiceUnavailableException({ error: "Invoice service assertion required but unavailable" });
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json", Accept: "application/pdf",
        "x-service-name": "filspresso-backend",
      };
      if (serviceAssertion) headers["x-service-assertion"] = serviceAssertion;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${this.invoiceServiceUrl}/api/invoices/render`, {
          method: "POST",
          headers,
          body: JSON.stringify({ invoiceNumber: `INV-${order["order_number"]}`, orderNumber: order["order_number"], generatedAt: new Date().toISOString() }),
          signal: controller.signal,
        });
        if (!response.ok) return null;
        return Buffer.from(await response.arrayBuffer());
      } finally { clearTimeout(timeout); }
    } finally { client.release(); }
  }

  // Role check helper
  assertAdmin(user: Record<string, unknown>): void {
    if (!user || String(user["role"] || "").toLowerCase() !== "admin") {
      throw new ForbiddenException({ error: "Admin access required" });
    }
  }
}
