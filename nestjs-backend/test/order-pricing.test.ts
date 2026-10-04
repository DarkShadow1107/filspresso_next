import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

const SERVICE = path.resolve(__dirname, "..", "src", "orders", "orders.service.ts");

/**
 * Phase 6.2: the checkout total must come from the database.
 *
 * Before this, `createOrder` read `unitPrice`, `totalPrice` and `shippingCost` off the
 * request body and totalled those. A client could post a coffee capsule at 0.01 and get
 * a real order for it. These assert the trust boundary by reading the source, because
 * the interesting failures are all "did the server consult the database instead of the
 * caller" and there is no way to express that as a pure unit test of the arithmetic.
 */
function createOrderSource(): string {
  const src = readFileSync(SERVICE, "utf8");
  const start = src.indexOf("async createOrder(");
  assert.notEqual(start, -1, "createOrder() not found");
  const end = src.indexOf("\n  // ── ", start + 10);
  assert.notEqual(end, -1, "could not bound createOrder()");
  return src.slice(start, end);
}

describe("createOrder trusts the database, not the client", () => {
  const body = createOrderSource();

  it("never reads a price off the request", () => {
    // The single most important assertion in this file.
    assert.doesNotMatch(
      body,
      /item\["unitPrice"\]|item\["unit_price"\]|item\["totalPrice"\]|item\["total_price"\]/,
      "createOrder must not read a price from the request body",
    );
  });

  it("never reads shipping off the request", () => {
    assert.doesNotMatch(
      body,
      /body\["shippingCost"\]|body\["shipping_cost"\]/,
      "shipping must not come from the request body",
    );
  });

  it("never reads a product name or image off the request", () => {
    assert.doesNotMatch(
      body,
      /item\["productName"\]|item\["product_name"\]|item\["productImage"\]|item\["product_image"\]/,
      "persisted name and image must come from the catalogue",
    );
  });

  it("takes only identity and quantity from the request", () => {
    assert.match(body, /item\["productId"\] \?\? item\["product_id"\]/);
    assert.match(body, /item\["quantity"\] \?\? 1/);
  });

  it("prices from both catalogue tables", () => {
    assert.match(body, /FROM coffee_products[\s\S]*?FOR UPDATE/);
    assert.match(body, /FROM machine_products[\s\S]*?FOR UPDATE/);
  });

  it("locks the stock rows it prices", () => {
    // Without FOR UPDATE two concurrent checkouts can both pass the stock check.
    const forUpdate = body.match(/FOR UPDATE/g) ?? [];
    assert.ok(forUpdate.length >= 2, `expected both catalogue reads to lock, saw ${forUpdate.length}`);
  });

  it("rejects an unknown product instead of inventing a price", () => {
    assert.match(body, /PRODUCT_NOT_FOUND/);
    assert.match(body, /ConflictException/);
  });

  it("rejects insufficient stock", () => {
    assert.match(body, /INSUFFICIENT_STOCK/);
    assert.match(body, /row\.stock < quantity/);
  });

  it("decrements stock, guarded on having enough", () => {
    assert.match(body, /UPDATE coffee_products SET stock = stock - \$1[\s\S]*?stock >= \$1/);
    assert.match(body, /UPDATE machine_products SET stock = stock - \$1[\s\S]*?stock >= \$1/);
  });

  it("rounds money at each step rather than accumulating floats", () => {
    assert.match(body, /roundMoney\(/);
    assert.match(
      readFileSync(SERVICE, "utf8"),
      /function roundMoney[\s\S]*?Math\.round\([\s\S]*?\) \/ 100/,
      "roundMoney must round to minor units",
    );
  });

  it("uses a sequence for the order number", () => {
    assert.match(body, /nextval\('orders_order_number_seq'\)/);
    assert.doesNotMatch(body, /ORD-\$\{Date\.now\(\)\}/, "Date.now() order numbers can collide");
  });

  it("inserts all order items in one statement", () => {
    const inserts = body.match(/INSERT INTO order_items/g) ?? [];
    assert.equal(inserts.length, 1, "order_items must be inserted once, not once per item");
    assert.match(body, /FROM unnest\(\$2::text\[\]/);
  });
});

describe("money and catalogue constants", () => {
  const src = readFileSync(SERVICE, "utf8");

  it("takes the shipping rate and free threshold from configuration", () => {
    // Not hardcoded, because they are business facts about the carrier, not the code.
    // readMoneyEnv(name, fallback) reads process.env[name] and falls back when unset.
    assert.match(src, /function readMoneyEnv\(name: string, fallback: number\)/);
    assert.match(src, /readMoneyEnv\("SHIPPING_FLAT_RON", 24\.99\)/);
    assert.match(src, /readMoneyEnv\("SHIPPING_FREE_ABOVE_RON", 200\)/);
  });

  it("never reads an exchange rate off the request", () => {
    // The rate decides what the customer pays. A rate in the body is a rate the caller
    // chose, so this is checked on the whole file rather than only createOrder, in case
    // it reappears anywhere else.
    assert.doesNotMatch(
      src,
      /body\["exchangeRate"\]|body\["exchange_rate"\]|body\["rate"\]/,
      "the exchange rate must come from the FX service, never the request",
    );
  });

  it("charges shipping per band, not a flat rate", () => {
    // A single flat rate was wrong: the rule is a flat fee under a threshold and free
    // above it, so the threshold has to be applied rather than ignored.
    assert.match(src, /function shippingCostForRon\(/);
    assert.match(
      src,
      /merchandiseTotal >= SHIPPING_FREE_ABOVE_RON \? 0 : SHIPPING_FLAT_RON/,
    );
  });


  it("guards against a nonsense configured shipping rate", () => {
    assert.match(src, /Number\.isFinite\(raw\) && raw >= 0/);
  });
});