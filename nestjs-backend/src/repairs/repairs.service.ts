import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

const DEFAULT_LAT = 44.4323;
const DEFAULT_LON = 26.1063;

@Injectable()
export class RepairsService {
  constructor(private readonly db: DatabaseService) {}

  async getRepairs(accountId: number): Promise<unknown> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT r.*, o.order_number, uc.card_type, uc.card_last_four
         FROM repairs r
         LEFT JOIN orders o ON r.order_id = o.id
         LEFT JOIN user_cards uc ON r.payment_card_id = uc.id
         WHERE r.account_id = $1 ORDER BY r.created_at DESC`,
        [accountId],
      );
      return { repairs: result.rows };
    } finally { client.release(); }
  }

  async submitRepair(accountId: number, body: {
    machine_id?: string; machine_name?: string; repair_type?: string;
    is_warranty?: boolean; estimated_cost?: number; order_id?: number; payment_card_id?: number;
  }): Promise<unknown> {
    const { machine_id, machine_name, repair_type, is_warranty, estimated_cost, payment_card_id } = body;
    if (!machine_id || !repair_type) throw new BadRequestException({ error: "Missing required fields" });

    // 1. Check weather for delivery adjustment
    let isBadWeather = false;
    try {
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${DEFAULT_LAT}&longitude=${DEFAULT_LON}&current=precipitation,weather_code`,
      );
      if (weatherRes.ok) {
        const wd = await weatherRes.json() as Record<string, Record<string, number>>;
        const precip = wd.current?.precipitation || 0;
        const code = wd.current?.weather_code || 0;
        if (precip > 0.5 || (code >= 51 && code <= 99)) isBadWeather = true;
      }
    } catch { /* best-effort */ }

    // 2. Calculate duration
    let baseDays = is_warranty ? 5 : 3 + Math.min(4, Math.ceil((estimated_cost || 0) / 50));
    const duration = baseDays + (is_warranty ? 2 : 0) + (isBadWeather ? 1 : 0);
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + duration);

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const orderNumber = `REP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
      const orderResult = await client.query(
        `INSERT INTO orders (account_id, order_number, status, subtotal, shipping_cost, tax, total,
                payment_method, card_id, created_at, estimated_delivery, weather_condition, expected_delivery_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11, $12) RETURNING id`,
        [
          accountId, orderNumber, "processing", estimated_cost, 0, 0, estimated_cost,
          is_warranty ? "warranty" : "card", payment_card_id || null,
          `${duration} days`, isBadWeather ? "rain" : "clear", deliveryDate.toISOString().split("T")[0],
        ],
      );
      const newOrderId = orderResult.rows[0].id as number;
      await client.query(
        `INSERT INTO order_items (order_id, product_type, product_id, product_name, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newOrderId, "service", machine_id, `Repair Service: ${machine_name} (${repair_type})${is_warranty ? " [WARRANTY]" : ""}`, 1, estimated_cost, estimated_cost],
      );
      const cleanMachineName = String(machine_name || "").replace(/\s*-\s*[\d,.]+\s*RON\s*$/i, "").trim();
      await client.query(
        `INSERT INTO repairs (account_id, order_id, machine_id, machine_name, repair_type, is_warranty,
                estimated_cost, estimated_duration, weather_delay, warranty_delay, status, pickup_date, payment_card_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          accountId, newOrderId, machine_id, cleanMachineName, repair_type, is_warranty,
          estimated_cost, duration, isBadWeather, is_warranty, "pending", deliveryDate, is_warranty ? null : payment_card_id || null,
        ],
      );
      await client.query("COMMIT");
      return { success: true, orderId: Number(newOrderId), orderNumber, estimatedDuration: duration, estimatedDelivery: deliveryDate.toISOString(), isBadWeather };
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  }
}
