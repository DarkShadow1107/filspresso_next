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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CardsService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const encryption = __importStar(require("../common/utils/encryption"));
let CardsService = class CardsService {
    db;
    constructor(db) {
        this.db = db;
    }
    async getCards(accountId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT id, card_holder, card_type, card_last_four,
                card_expiry_encrypted, card_cvv_encrypted, is_default, created_at
         FROM user_cards WHERE account_id = $1 ORDER BY is_default DESC, created_at DESC`, [accountId]);
            return result.rows.map((card) => {
                const decryptedExpiry = encryption.decrypt(String(card.card_expiry_encrypted || ""));
                const decryptedCvv = card.card_cvv_encrypted
                    ? encryption.decrypt(String(card.card_cvv_encrypted))
                    : "";
                const hasDecryptionIssue = (Boolean(card.card_expiry_encrypted) && !decryptedExpiry) ||
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
        }
        finally {
            client.release();
        }
    }
    async addCard(accountId, body) {
        const { cardNumber, expiry, cvv, cardHolder, isDefault } = body;
        if (!cardNumber || !expiry || !cardHolder) {
            throw new common_1.BadRequestException({ error: "Card number, expiry, and card holder are required" });
        }
        const cleanedNumber = String(cardNumber).replace(/\D/g, "");
        if (cleanedNumber.length < 13 || cleanedNumber.length > 19) {
            throw new common_1.BadRequestException({ error: "Invalid card number" });
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
            const result = await client.query(`INSERT INTO user_cards
         (account_id, card_number_encrypted, card_expiry_encrypted, card_cvv_encrypted,
          card_holder, card_type, card_last_four, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [accountId, encryptedNumber, encryptedExpiry, encryptedCvv, cardHolder, cardType, lastFour, isDefault || false]);
            return { id: Number(result.rows[0]?.id), card_holder: cardHolder, card_type: cardType, card_last_four: lastFour, is_default: isDefault || false };
        }
        finally {
            client.release();
        }
    }
    async updateCard(accountId, cardId, body) {
        const { cardHolder, isDefault } = body;
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const ownership = await client.query("SELECT id FROM user_cards WHERE id = $1 AND account_id = $2", [cardId, accountId]);
            if (!ownership.rows[0])
                throw new common_1.NotFoundException({ error: "Card not found" });
            if (isDefault) {
                await client.query("UPDATE user_cards SET is_default = FALSE WHERE account_id = $1", [accountId]);
            }
            const setClauses = [];
            const params = [];
            let idx = 1;
            if (cardHolder !== undefined) {
                setClauses.push(`card_holder = $${idx++}`);
                params.push(cardHolder);
            }
            if (isDefault !== undefined) {
                setClauses.push(`is_default = $${idx++}`);
                params.push(isDefault);
            }
            if (setClauses.length > 0) {
                params.push(cardId);
                await client.query(`UPDATE user_cards SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${idx}`, params);
            }
        }
        finally {
            client.release();
        }
    }
    async deleteCard(accountId, cardId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const ownership = await client.query("SELECT id FROM user_cards WHERE id = $1 AND account_id = $2", [cardId, accountId]);
            if (!ownership.rows[0])
                throw new common_1.NotFoundException({ error: "Card not found" });
            await client.query("DELETE FROM user_cards WHERE id = $1", [cardId]);
        }
        finally {
            client.release();
        }
    }
};
exports.CardsService = CardsService;
exports.CardsService = CardsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], CardsService);
