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
var FxRatesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FxRatesService = exports.FALLBACK_RATES = exports.DESTINATION_CURRENCY = exports.CURRENCY_FEE_PERCENT = exports.BASE_CURRENCY = void 0;
const common_1 = require("@nestjs/common");
const egressPolicy_1 = require("../common/utils/egressPolicy");
const database_service_1 = require("../database/database.service");
/**
 * Server-side FX for order totals.
 *
 * The rate has to be resolved here rather than in the browser or in the Next layer,
 * because `POST /api/orders` reaches this service from a request the caller controls.
 * A rate taken from the request is a rate the caller chooses, so a browser could post
 * `rate=0.0001` and pay almost nothing. The rate is fetched over the server's own
 * egress, snapshotted onto the order, and never read from the request.
 *
 * `src/lib/paymentCurrency.ts` is the front-end's copy of the same tables and the
 * `/api/fx/latest` route is its copy of the same fetch. They cannot import each other
 * (separate processes), so `test/fx-rates.test.ts` parses the TypeScript source and fails
 * if the fee percentages or destination currencies drift.
 */
exports.BASE_CURRENCY = "RON";
/** Mirrors `CURRENCY_CONFIG` in src/lib/paymentCurrency.ts. */
exports.CURRENCY_FEE_PERCENT = {
    RON: 0,
    EUR: 5,
    CZK: 8,
    DKK: 10,
    PLN: 9,
    CHF: 15,
    TRY: 25,
};
/**
 * ISO-3166 alpha-2 -> the currency that country is charged in.
 *
 * Exactly the 29 destinations in `SUPPORTED_DESTINATIONS`. GB, NO and the US are
 * deliberately absent: they are not in that list, and inventing a GBP or NOK mapping
 * here would send a customer to a currency this build cannot charge.
 */
exports.DESTINATION_CURRENCY = {
    AT: "EUR", BE: "EUR", BG: "EUR", HR: "EUR", CY: "EUR", RO: "RON",
    CZ: "CZK", DK: "DKK", EE: "EUR", FI: "EUR", FR: "EUR", DE: "EUR",
    GR: "EUR", HU: "EUR", IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR",
    LU: "EUR", MT: "EUR", NL: "EUR", PL: "PLN", PT: "EUR", SK: "EUR",
    SI: "EUR", ES: "EUR", SE: "EUR", CH: "CHF", TR: "TRY",
};
/**
 * Last-resort rates, RON base, used only when every provider fails.
 *
 * Deliberately the same conservative set as `FALLBACK_FX_RATES`. These are a guess, and
 * a wrong guess silently undercharges, so a fallback is only reached when the network
 * is unavailable and it is reported in `source` so it can be surfaced.
 */
exports.FALLBACK_RATES = {
    RON: 1, EUR: 0.2, CZK: 5.05, DKK: 1.49, PLN: 0.86, CHF: 0.19, TRY: 7.01,
};
const FX_TIMEOUT_MS = 7000;
const FRESH_MS = 36 * 60 * 60 * 1000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
let FxRatesService = FxRatesService_1 = class FxRatesService {
    db;
    logger = new common_1.Logger(FxRatesService_1.name);
    cache = null;
    constructor(db) {
        this.db = db;
    }
    /** True when this build knows how to charge in that currency. */
    supports(currency) {
        return Object.prototype.hasOwnProperty.call(exports.CURRENCY_FEE_PERCENT, currency);
    }
    /**
     * The rate to charge `currency` at, plus the fee schedule.
     *
     * Always succeeds: if no provider answers, the static fallback is returned with
     * `source: "static_fallback"` rather than refusing the order. A slightly wrong rate
     * and a completed order beats a correct rate and a failed checkout.
     */
    async resolve(currency) {
        const code = String(currency || exports.BASE_CURRENCY).trim().toUpperCase();
        if (!this.supports(code)) {
            throw new Error(`unsupported currency ${code}`);
        }
        const feePercent = exports.CURRENCY_FEE_PERCENT[code] ?? 0;
        // The base currency is not a conversion, so it never touches the network. That keeps
        // domestic checkout working even with FX egress entirely broken.
        if (code === exports.BASE_CURRENCY) {
            return { currency: code, rate: 1, date: today(), source: "base", feePercent, stale: false };
        }
        const live = await this.fetchLive();
        if (live) {
            this.cache = { rates: live.rates, date: live.date, fetchedAt: Date.now() };
            await this.persistSnapshot(code, live.rates[code], live.date, "live_open_er_api");
            return { currency: code, rate: live.rates[code], date: live.date, source: "live_open_er_api", feePercent, stale: false };
        }
        const cached = this.readCache();
        if (cached && cached.rates[code]) {
            return {
                currency: code,
                rate: cached.rates[code],
                date: cached.date,
                source: Date.now() - cached.fetchedAt <= FRESH_MS ? "cached_live" : "cached_live_stale",
                feePercent,
                stale: true,
            };
        }
        const rate = exports.FALLBACK_RATES[code];
        this.logger.warn(`FX providers unavailable; using static fallback for ${code} (${rate})`);
        return { currency: code, rate, date: today(), source: "static_fallback", feePercent, stale: true };
    }
    readCache() {
        if (!this.cache)
            return null;
        return Date.now() - this.cache.fetchedAt <= STALE_MS ? this.cache : null;
    }
    /**
     * Fetch every supported currency in one call.
     *
     * `api.frankfurter.app` answers with a 301 to its new host, so following it is left to
     * the runtime and open.er-api is the reliable provider. If frankfurter ever answers
     * directly again this costs nothing extra, because only the first usable reply counts.
     */
    async fetchLive() {
        const codes = Object.keys(exports.CURRENCY_FEE_PERCENT).filter((c) => c !== exports.BASE_CURRENCY);
        const url = `https://open.er-api.com/v6/latest/${exports.BASE_CURRENCY}`;
        try {
            (0, egressPolicy_1.assertAllowedEgress)(url, "fx");
        }
        catch (e) {
            this.logger.warn(`FX egress blocked: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FX_TIMEOUT_MS);
        try {
            // `cache: "no-store"` is a Next extension, not part of the RequestInit this lib
            // compiles against. The AbortController already bounds it, and no HTTP cache
            // header is sent that would let an intermediary serve a stale rate.
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok)
                return null;
            const payload = (await response.json());
            if (payload.result && payload.result !== "success")
                return null;
            const rates = { RON: 1 };
            let usable = 0;
            for (const code of codes) {
                const value = Number(payload.rates?.[code]);
                // A rate of zero, negative, or NaN would silently produce a free or nonsense
                // order, so anything unusable is dropped rather than coerced.
                if (Number.isFinite(value) && value > 0) {
                    rates[code] = value;
                    usable += 1;
                }
            }
            // A "successful" response with no usable rate is a failure, not a rate of 1.
            if (usable === 0)
                return null;
            const date = isoDate(payload.time_last_update_utc) || isoDate(payload.time_last_update_unix) || today();
            return { rates, date };
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    /**
     * Snapshot the rate onto every order that used it.
     *
     * Without this, rendering a historical order would need a live lookup, and the rate
     * would silently change as the market moves -- an order could appear to have been
     * charged a different amount than it was.
     */
    async persistSnapshot(currency, rate, date, source) {
        try {
            const pool = this.db.getPool();
            await pool.query(`INSERT INTO fx_rate_snapshots (base_currency, currency_code, rate, rate_date, source, fetched_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (base_currency, currency_code, rate_date, source) DO UPDATE SET rate = EXCLUDED.rate`, [exports.BASE_CURRENCY, currency, rate, date, source]);
        }
        catch (e) {
            // Never fail a checkout because the audit snapshot could not be written.
            this.logger.warn(`fx snapshot write failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
};
exports.FxRatesService = FxRatesService;
exports.FxRatesService = FxRatesService = FxRatesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], FxRatesService);
function today() {
    return new Date().toISOString().slice(0, 10);
}
function isoDate(value) {
    if (typeof value === "string" && value.trim()) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime()))
            return parsed.toISOString().slice(0, 10);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return new Date(value * 1000).toISOString().slice(0, 10);
    }
    return null;
}
