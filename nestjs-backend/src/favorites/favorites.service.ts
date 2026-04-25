import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

@Injectable()
export class FavoritesService {
  constructor(private readonly db: DatabaseService) {}

  async getFavorites(accountId: number): Promise<unknown[]> {
    const result = await this.db.getPool().query(
      "SELECT product_type, product_category, product_id, created_at FROM favorites WHERE account_id = $1 ORDER BY created_at DESC",
      [accountId],
    );
    return result.rows;
  }

  async addFavorite(accountId: number, body: { product_type?: string; product_id?: string; product_category?: string }): Promise<void> {
    const { product_type, product_id, product_category } = body;
    if (!product_type || !product_id) {
      throw new BadRequestException({ status: "error", message: "Product type and ID are required" });
    }
    await this.db.getPool().query(
      "INSERT INTO favorites (account_id, product_type, product_id, product_category) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, product_type, product_id) DO UPDATE SET product_category = EXCLUDED.product_category",
      [accountId, product_type, product_id, product_category || null],
    );
  }

  async removeFavorite(accountId: number, type: string, id: string): Promise<void> {
    await this.db.getPool().query(
      "DELETE FROM favorites WHERE account_id = $1 AND product_type = $2 AND product_id = $3",
      [accountId, type, id],
    );
  }

  async syncFavorites(accountId: number, favorites: Array<{ product_type: string; product_id: string; product_category?: string }>): Promise<void> {
    if (!Array.isArray(favorites)) throw new BadRequestException({ status: "error", message: "Favorites array is required" });
    if (favorites.length === 0) return;
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const fav of favorites) {
        await client.query(
          "INSERT INTO favorites (account_id, product_type, product_id, product_category) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, product_type, product_id) DO UPDATE SET product_category = EXCLUDED.product_category",
          [accountId, fav.product_type, fav.product_id, fav.product_category || null],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}
