import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

import {
  CURRENCY_FEE_PERCENT,
  DESTINATION_CURRENCY,
  FALLBACK_RATES,
  BASE_CURRENCY,
} from "../src/orders/fx-rates.service";

const PAYMENT_LIB = path.resolve(__dirname, "..", "..", "src", "lib", "paymentCurrency.ts");
const MIGRATION = path.resolve(__dirname, "..", "data", "migrations", "2026-10-orders-fx-rates.sql");

/**
 * The fee schedule and destination currencies exist twice: in the NestJS backend, which
 * decides what a customer is charged, and in `src/lib/paymentCurrency.ts`, which decides
 * what the checkout UI quotes. If they disagree, the customer is shown one price and
 * charged another -- so the drift is asserted here rather than discovered at checkout.
 */

function parseFeePercent(): Record<string, number> {
  const src = readFileSync(PAYMENT_LIB, "utf8");
  const start = src.indexOf("CURRENCY_CONFIG");
  const open = src.indexOf("{", start);
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  assert.notEqual(close, -1, "CURRENCY_CONFIG literal not closed");
  const literal = src.slice(open, close + 1).replace(/\/\/[^\n]*/g, "");
  // eslint-disable-next-line no-new-func
  const parsed = new Function(`return ${literal};`)() as Record<string, { feePercent: number }>;
  const out: Record<string, number> = {};
  for (const [code, cfg] of Object.entries(parsed)) out[code] = cfg.feePercent;
  return out;
}

function parseDestinationCurrencies(): Record<string, string> {
  const src = readFileSync(PAYMENT_LIB, "utf8");
  const out: Record<string, string> = {};
  // `code: "AT"` ... `defaultCurrency: "EUR"` pairs.
  for (const m of src.matchAll(/code:\s*"([A-Z]{2})"[\s\S]{0,120}?defaultCurrency:\s*"([A-Z]{3})"/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

describe("currency configuration parity", () => {
  it("charges the same currencies as the checkout UI", () => {
    assert.deepEqual(
      Object.keys(CURRENCY_FEE_PERCENT).sort(),
      Object.keys(parseFeePercent()).sort(),
      "backend supports a different set of currencies than the UI quotes",
    );
  });

  it("charges the same fee per currency", () => {
    const ui = parseFeePercent();
    const drift: string[] = [];
    for (const [code, fee] of Object.entries(CURRENCY_FEE_PERCENT)) {
      if (ui[code] !== fee) drift.push(`${code}: ui=${ui[code]} backend=${fee}`);
    }
    assert.deepEqual(drift, [], "conversion fee drift");
  });

  it("agrees on which currency each country is charged in", () => {
    const ui = parseDestinationCurrencies();
    const drift: string[] = [];
    for (const [country, currency] of Object.entries(DESTINATION_CURRENCY)) {
      if (ui[country] && ui[country] !== currency) {
        drift.push(`${country}: ui=${ui[country]} backend=${currency}`);
      }
    }
    assert.deepEqual(drift, [], "destination currency drift");
  });

  it("never charges the base currency a conversion fee", () => {
    // A fee on RON would silently inflate every domestic order.
    assert.equal(CURRENCY_FEE_PERCENT[BASE_CURRENCY], 0);
  });

  it("only sends a customer to a currency it can actually charge", () => {
    for (const currency of Object.values(DESTINATION_CURRENCY)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CURRENCY_FEE_PERCENT, currency),
        `destination maps to ${currency}, which has no fee schedule`,
      );
    }
  });

  it("has a fallback rate for every supported currency", () => {
    for (const code of Object.keys(CURRENCY_FEE_PERCENT)) {
      assert.ok(FALLBACK_RATES[code] > 0, `no positive fallback rate for ${code}`);
    }
    assert.equal(FALLBACK_RATES[BASE_CURRENCY], 1);
  });

  it("grants the app role the privileges the snapshot write needs", () => {
    // ON CONFLICT DO UPDATE needs UPDATE, not just INSERT. Missing it failed silently on
    // every live rate, which is the audit trail this table exists for.
    const sql = readFileSync(MIGRATION, "utf8");
    assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON fx_rate_snapshots/);
    assert.match(sql, /GRANT USAGE, SELECT ON SEQUENCE fx_rate_snapshots_id_seq/);
  });

  it("constrains the snapshot rate to be positive", () => {
    assert.match(readFileSync(MIGRATION, "utf8"), /CHECK \(rate > 0\)/);
  });
});