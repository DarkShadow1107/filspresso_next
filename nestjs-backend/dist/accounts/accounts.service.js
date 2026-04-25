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
exports.AccountsService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const VALID_THEMES = ["classic", "neon", "minimal", "gradient", "monochrome"];
let AccountsService = class AccountsService {
    db;
    constructor(db) {
        this.db = db;
    }
    async getAccount(requesterId, accountId) {
        if (requesterId !== accountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT a.id, a.username, a.email, a.name, a.icon, a.subscription_id,
                a.email_verified, a.last_login, a.created_at,
                s.name AS subscription_name, s.description AS subscription_description,
                s.price_ron AS subscription_price, s.features AS subscription_features
         FROM accounts a
         LEFT JOIN subscriptions s ON a.subscription_id = s.id
         WHERE a.id = $1`, [accountId]);
            const account = result.rows[0];
            if (!account) {
                throw new common_1.NotFoundException({ error: "Account not found" });
            }
            return account;
        }
        finally {
            client.release();
        }
    }
    async updateAccount(requesterId, accountId, updates) {
        if (requesterId !== accountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        const { name, icon, username } = updates;
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            if (username) {
                const existing = await client.query("SELECT id FROM accounts WHERE username = $1 AND id != $2", [username.toLowerCase(), accountId]);
                if (existing.rows.length > 0) {
                    throw new common_1.BadRequestException({ error: "Username already taken" });
                }
            }
            const setClauses = [];
            const params = [];
            let idx = 1;
            if (name !== undefined) {
                setClauses.push(`name = $${idx++}`);
                params.push(name);
            }
            if (icon !== undefined) {
                setClauses.push(`icon = $${idx++}`);
                params.push(icon);
            }
            if (username !== undefined) {
                setClauses.push(`username = $${idx++}`);
                params.push(username.toLowerCase());
            }
            if (setClauses.length === 0) {
                throw new common_1.BadRequestException({ error: "No fields to update" });
            }
            params.push(accountId);
            await client.query(`UPDATE accounts SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${idx}`, params);
            const result = await client.query("SELECT id, username, email, name, icon, subscription_id FROM accounts WHERE id = $1", [accountId]);
            return result.rows[0];
        }
        finally {
            client.release();
        }
    }
    async deleteAccount(requesterId, accountId) {
        if (requesterId !== accountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("DELETE FROM accounts WHERE id = $1", [accountId]);
        }
        finally {
            client.release();
        }
    }
    async updateSubscription(requesterId, accountId, subscriptionId) {
        if (requesterId !== accountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query("SELECT id, name FROM subscriptions WHERE id = $1", [subscriptionId]);
            const subscription = result.rows[0];
            if (!subscription) {
                throw new common_1.NotFoundException({ error: "Subscription not found" });
            }
            await client.query("UPDATE accounts SET subscription_id = $1, updated_at = NOW() WHERE id = $2", [subscriptionId, accountId]);
            return { subscription: String(subscription.name) };
        }
        finally {
            client.release();
        }
    }
    async updatePreferences(accountId, body) {
        const hasGraphTheme = Object.prototype.hasOwnProperty.call(body, "graph_theme");
        const hasInvoicePreference = Object.prototype.hasOwnProperty.call(body, "invoice_include_product_view");
        if (hasGraphTheme && body.graph_theme && !VALID_THEMES.includes(body.graph_theme)) {
            throw new common_1.BadRequestException({ error: "Invalid theme" });
        }
        if (hasInvoicePreference && typeof body.invoice_include_product_view !== "boolean") {
            throw new common_1.BadRequestException({ error: "invoice_include_product_view must be a boolean" });
        }
        if (!hasGraphTheme && !hasInvoicePreference) {
            throw new common_1.BadRequestException({ error: "No preferences to update" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            if (hasInvoicePreference) {
                // Ensure column exists (defensive migration)
                await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS invoice_include_product_view BOOLEAN DEFAULT TRUE`);
            }
            const setClauses = [];
            const params = [];
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
            await client.query(`UPDATE accounts SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${idx}`, params);
            const result = await client.query(`SELECT graph_theme,
                COALESCE((to_jsonb(accounts)->>'invoice_include_product_view')::boolean, TRUE)
                  AS invoice_include_product_view
         FROM accounts WHERE id = $1`, [accountId]);
            return {
                graph_theme: String(result.rows[0]?.graph_theme || "classic"),
                invoice_include_product_view: result.rows[0]?.invoice_include_product_view !== false,
            };
        }
        finally {
            client.release();
        }
    }
    async getPreferences(requesterId, accountId) {
        if (requesterId !== accountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT graph_theme,
                COALESCE((to_jsonb(accounts)->>'invoice_include_product_view')::boolean, TRUE)
                  AS invoice_include_product_view
         FROM accounts WHERE id = $1`, [accountId]);
            if (!result.rows[0]) {
                throw new common_1.NotFoundException({ error: "Account not found" });
            }
            return {
                graph_theme: String(result.rows[0].graph_theme || "classic"),
                invoice_include_product_view: result.rows[0].invoice_include_product_view !== false,
            };
        }
        finally {
            client.release();
        }
    }
};
exports.AccountsService = AccountsService;
exports.AccountsService = AccountsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], AccountsService);
