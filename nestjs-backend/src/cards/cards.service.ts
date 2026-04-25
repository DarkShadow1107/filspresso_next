import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as encryption from "../common/utils/encryption";

@Injectable()
export class CardsService {
  constructor(private readonly db: DatabaseService) {}

  async getCards(accountId: number): Promise<unknown[]> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, card_holder, card_type, card_last_four,
                card_expiry_encrypted, card_cvv_encrypted, is_default, created_at
         FROM user_cards WHERE account_id = $1 ORDER BY is_default DESC, created_at DESC`,
        [accountId],
      );
      return result.rows.map((card) => {
        const decryptedExpiry = encryption.decrypt(String(card.card_expiry_encrypted || ""));
        const decryptedCvv = card.card_cvv_encrypted
          ? encryption.decrypt(String(card.card_cvv_encrypted))
          : "";
        const hasDecryptionIssue =
          (Boolean(card.card_expiry_encrypted) && !decryptedExpiry) ||
          (Boolean(card.card_cvv_encrypted) && !decryptedCvv);
        return {
          id: Number(card.id),
          card_holder: card.card_holder,
          card_type: card.card_type,
          card_last_four: card.card_last_four,
          card_expiry: decryptedExpiry || null,
          card_cvv: decryptedCvv || null,
          has_decryption_issue: hasDecryptionIssue,
          is_default: Boolean(card.is_default),
          created_at: card.created_at,
        };
      });
    } finally {
      client.release();
    }
  }

  async addCard(accountId: number, body: {
    cardNumber?: string;
    expiry?: string;
    cvv?: string;
    cardHolder?: string;
    isDefault?: boolean;
  }): Promise<unknown> {
    const { cardNumber, expiry, cvv, cardHolder, isDefault } = body;
    if (!cardNumber || !expiry || !cardHolder) {
      throw new BadRequestException({ error: "Card number, expiry, and card holder are required" });
    }
    const cleanedNumber = String(cardNumber).replace(/\D/g, "");
    if (cleanedNumber.length < 13 || cleanedNumber.length > 19) {
      throw new BadRequestException({ error: "Invalid card number" });
    }
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      if (isDefault) {
        await client.query("UPDATE user_cards SET is_default = FALSE WHERE account_id = $1", [accountId]);
      }
      const encryptedNumber = encryption.encrypt(cleanedNumber);
      const encryptedExpiry = encryption.encrypt(expiry);
      const encryptedCvv = cvv ? encryption.encrypt(cvv) : null;
      const lastFour = encryption.getLastFour(cleanedNumber);
      const cardType = encryption.detectCardType(cleanedNumber);
      const result = await client.query(
        `INSERT INTO user_cards
         (account_id, card_number_encrypted, card_expiry_encrypted, card_cvv_encrypted,
          card_holder, card_type, card_last_four, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [accountId, encryptedNumber, encryptedExpiry, encryptedCvv, cardHolder, cardType, lastFour, isDefault || false],
      );
      return { id: Number(result.rows[0]?.id), card_holder: cardHolder, card_type: cardType, card_last_four: lastFour, is_default: isDefault || false };
    } finally {
      client.release();
    }
  }

  async updateCard(accountId: number, cardId: number, body: { cardHolder?: string; isDefault?: boolean }): Promise<void> {
    const { cardHolder, isDefault } = body;
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const ownership = await client.query("SELECT id FROM user_cards WHERE id = $1 AND account_id = $2", [cardId, accountId]);
      if (!ownership.rows[0]) throw new NotFoundException({ error: "Card not found" });
      if (isDefault) {
        await client.query("UPDATE user_cards SET is_default = FALSE WHERE account_id = $1", [accountId]);
      }
      const setClauses: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (cardHolder !== undefined) { setClauses.push(`card_holder = $${idx++}`); params.push(cardHolder); }
      if (isDefault !== undefined) { setClauses.push(`is_default = $${idx++}`); params.push(isDefault); }
      if (setClauses.length > 0) {
        params.push(cardId);
        await client.query(`UPDATE user_cards SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${idx}`, params);
      }
    } finally {
      client.release();
    }
  }

  async deleteCard(accountId: number, cardId: number): Promise<void> {
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      const ownership = await client.query("SELECT id FROM user_cards WHERE id = $1 AND account_id = $2", [cardId, accountId]);
      if (!ownership.rows[0]) throw new NotFoundException({ error: "Card not found" });
      await client.query("DELETE FROM user_cards WHERE id = $1", [cardId]);
    } finally {
      client.release();
    }
  }
}
