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
exports.FavoritesService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
let FavoritesService = class FavoritesService {
    db;
    constructor(db) {
        this.db = db;
    }
    async getFavorites(accountId) {
        const result = await this.db.getPool().query("SELECT product_type, product_category, product_id, created_at FROM favorites WHERE account_id = $1 ORDER BY created_at DESC", [accountId]);
        return result.rows;
    }
    async addFavorite(accountId, body) {
        const { product_type, product_id, product_category } = body;
        if (!product_type || !product_id) {
            throw new common_1.BadRequestException({ status: "error", message: "Product type and ID are required" });
        }
        await this.db.getPool().query("INSERT INTO favorites (account_id, product_type, product_id, product_category) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, product_type, product_id) DO UPDATE SET product_category = EXCLUDED.product_category", [accountId, product_type, product_id, product_category || null]);
    }
    async removeFavorite(accountId, type, id) {
        await this.db.getPool().query("DELETE FROM favorites WHERE account_id = $1 AND product_type = $2 AND product_id = $3", [accountId, type, id]);
    }
    async syncFavorites(accountId, favorites) {
        if (!Array.isArray(favorites))
            throw new common_1.BadRequestException({ status: "error", message: "Favorites array is required" });
        if (favorites.length === 0)
            return;
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const fav of favorites) {
                await client.query("INSERT INTO favorites (account_id, product_type, product_id, product_category) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, product_type, product_id) DO UPDATE SET product_category = EXCLUDED.product_category", [accountId, fav.product_type, fav.product_id, fav.product_category || null]);
            }
            await client.query("COMMIT");
        }
        catch (e) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw e;
        }
        finally {
            client.release();
        }
    }
};
exports.FavoritesService = FavoritesService;
exports.FavoritesService = FavoritesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], FavoritesService);
