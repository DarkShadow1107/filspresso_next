import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

const VALID_THEMES = ["classic", "neon", "minimal", "gradient", "monochrome"] as const;
type GraphTheme = (typeof VALID_THEMES)[number];

@Injectable()
export class AccountsService {
  constructor(private readonly db: DatabaseService) {}

  async getAccount(requesterId: number, accountId: number): Promise<Record<string, unknown>> {
    if (requesterId !== accountId) {
      throw new ForbiddenException({ error: "Access denied" });
    }
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT a.id, a.username, a.email, a.name, a.icon, a.subscription_id,
                a.email_verified, a.last_login, a.created_at,
                s.name AS subscription_name, s.description AS subscription_description,
                s.price_ron AS subscription_price, s.features AS subscription_features
         FROM accounts a
         LEFT JOIN subscriptions s ON a.subscription_id = s.id
         WHERE a.id = $1`,
        [accountId],
      );
      const account = result.rows[0];
      if (!account) {
        throw new NotFoundException({ error: "Account not found" });
      }
      return account as Record<string, unknown>;
    } finally {
      client.release();
    }
  }

  async updateAccount(
    requesterId: number,
    accountId: number,
    updates: { name?: string; icon?: string; username?: string },
  ): Promise<Record<string, unknown>> {
    if (requesterId !== accountId) {
      throw new ForbiddenException({ error: "Access denied" });
    }
    const { name, icon, username } = updates;
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      if (username) {
        const existing = await client.query(
          "SELECT id FROM accounts WHERE username = $1 AND id != $2",
          [username.toLowerCase(), accountId],
        );
        if (existing.rows.length > 0) {
          throw new BadRequestException({ error: "Username already taken" });
        }
      }

      const setClauses: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (name !== undefined) { setClauses.push(`name = $${idx++}`); params.push(name); }
      if (icon !== undefined) { setClauses.push(`icon = $${idx++}`); params.push(icon); }
      if (username !== undefined) { setClauses.push(`username = $${idx++}`); params.push(username.toLowerCase()); }

      if (setClauses.length === 0) {
        throw new BadRequestException({ error: "No fields to update" });
      }

      params.push(accountId);
      await client.query(
        `UPDATE accounts SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${idx}`,
        params,
      );

      const result = await client.query(
        "SELECT id, username, email, name, icon, subscription_id FROM accounts WHERE id = $1",
        [accountId],
      );
      return result.rows[0] as Record<string, unknown>;
    } finally {
      client.release();
    }
  }

  async deleteAccount(requesterId: number, accountId: number): Promise<void> {
    if (requesterId !== accountId) {
      throw new ForbiddenException({ error: "Access denied" });
    }
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("DELETE FROM accounts WHERE id = $1", [accountId]);
    } finally {
      client.release();
    }
  }

  async updateSubscription(
    requesterId: number,
    accountId: number,
    subscriptionId: number,
  ): Promise<{ subscription: string }> {
    if (requesterId !== accountId) {
      throw new ForbiddenException({ error: "Access denied" });
    }
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        "SELECT id, name FROM subscriptions WHERE id = $1",
        [subscriptionId],
      );
      const subscription = result.rows[0];
      if (!subscription) {
        throw new NotFoundException({ error: "Subscription not found" });
      }
      await client.query(
        "UPDATE accounts SET subscription_id = $1, updated_at = NOW() WHERE id = $2",
        [subscriptionId, accountId],
      );
      return { subscription: String(subscription.name) };
    } finally {
      client.release();
    }
  }

  async updatePreferences(
    accountId: number,
    body: { graph_theme?: string; invoice_include_product_view?: boolean },
  ): Promise<{ graph_theme: string; invoice_include_product_view: boolean }> {
    const hasGraphTheme = Object.prototype.hasOwnProperty.call(body, "graph_theme");
    const hasInvoicePreference = Object.prototype.hasOwnProperty.call(body, "invoice_include_product_view");

    if (hasGraphTheme && body.graph_theme && !VALID_THEMES.includes(body.graph_theme as GraphTheme)) {
      throw new BadRequestException({ error: "Invalid theme" });
    }
    if (hasInvoicePreference && typeof body.invoice_include_product_view !== "boolean") {
      throw new BadRequestException({ error: "invoice_include_product_view must be a boolean" });
    }
    if (!hasGraphTheme && !hasInvoicePreference) {
      throw new BadRequestException({ error: "No preferences to update" });
    }

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      if (hasInvoicePreference) {
        // Ensure column exists (defensive migration)
        await client.query(
          `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS invoice_include_product_view BOOLEAN DEFAULT TRUE`,
        );
      }

      const setClauses: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (hasGraphTheme) {
        setClauses.push(`graph_theme = $${idx++}`);
        params.push(body.graph_theme || "classic");
      }
      if (hasInvoicePreference) {
        setClauses.push(`invoice_include_product_view = $${idx++}`);
        params.push(body.invoice_include_product_view);
      }

      params.push(accountId);
      await client.query(
        `UPDATE accounts SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${idx}`,
        params,
      );

      const result = await client.query(
        `SELECT graph_theme,
                COALESCE((to_jsonb(accounts)->>'invoice_include_product_view')::boolean, TRUE)
                  AS invoice_include_product_view
         FROM accounts WHERE id = $1`,
        [accountId],
      );

      return {
        graph_theme: String(result.rows[0]?.graph_theme || "classic"),
        invoice_include_product_view: result.rows[0]?.invoice_include_product_view !== false,
      };
    } finally {
      client.release();
    }
  }

  async getPreferences(
    requesterId: number,
    accountId: number,
  ): Promise<{ graph_theme: string; invoice_include_product_view: boolean }> {
    if (requesterId !== accountId) {
      throw new ForbiddenException({ error: "Access denied" });
    }
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT graph_theme,
                COALESCE((to_jsonb(accounts)->>'invoice_include_product_view')::boolean, TRUE)
                  AS invoice_include_product_view
         FROM accounts WHERE id = $1`,
        [accountId],
      );
      if (!result.rows[0]) {
        throw new NotFoundException({ error: "Account not found" });
      }
      return {
        graph_theme: String(result.rows[0].graph_theme || "classic"),
        invoice_include_product_view: result.rows[0].invoice_include_product_view !== false,
      };
    } finally {
      client.release();
    }
  }
}
