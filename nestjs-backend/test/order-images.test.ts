import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

const SERVICE = path.resolve(__dirname, "..", "src", "orders", "orders.service.ts");
const CONTRACTS = path.resolve(__dirname, "..", "src", "common", "utils", "serviceContracts.ts");
const IMAGE_MIGRATION = path.resolve(__dirname, "..", "data", "migrations", "2026-10-coffee-image-path.sql");

/**
 * Order lines and invoices need product images.
 *
 * coffee_products stored a filename and extension but not the public path, and the path
 * cannot be rebuilt from those -- it needs a collection segment the catalogue does not
 * hold. So capsule order lines stored NULL while machine lines had an image.
 */
describe("catalogue image paths", () => {
  const service = readFileSync(SERVICE, "utf8");

  it("reads the image path from the catalogue, not the request", () => {
    assert.match(service, /SELECT product_id, name, price, stock, image_path FROM coffee_products/);
    assert.doesNotMatch(
      service,
      /item\["productImage"\]|item\["product_image"\]/,
      "a catalogue row must not supply an arbitrary path",
    );
  });

  it("stores only same-origin, traversal-free paths", () => {
    assert.match(service, /function normalizeImagePath\(/);
    // A scheme or protocol-relative prefix would make an invoice fetch an arbitrary host.
    assert.match(service, /\^\[a-z\]\[a-z0-9\+\.-\]\*:/i);
    assert.match(service, /startsWith\("\/\/"\)/);
    assert.match(service, /includes\("\.\."\)/);
  });

  it("constrains the column as well as the code", () => {
    const sql = readFileSync(IMAGE_MIGRATION, "utf8");
    assert.match(sql, /coffee_products ADD COLUMN IF NOT EXISTS image_path/);
    assert.match(sql, /coffee_products_image_path_chk/);
    // Three separate rejections: a scheme, a protocol-relative prefix, and traversal.
    assert.match(sql, /!\~\* '\^\[a-z\]/);
    assert.ok(sql.includes("image_path !~* '^//'"), "no protocol-relative guard in the CHECK constraint");
    // Traversal: the SQL spells this as a regex-escaped dot inside a string literal.
    assert.ok(sql.includes("image_path !~ '\\.\\.'"), "no traversal guard in the CHECK constraint");
  });
});

describe("invoice payload", () => {
  const service = readFileSync(SERVICE, "utf8");
  const contracts = readFileSync(CONTRACTS, "utf8");

  it("sends the line items", () => {
    // validateInvoiceRenderRequestV1 has always required `items`, yet the request only
    // carried invoiceNumber/orderNumber/generatedAt, so every invoice was blank.
    assert.match(service, /SELECT product_name, product_image, quantity, unit_price, total_price/);
    assert.match(service, /assertServiceContract\("invoice_render_request_v1"/);
  });

  it("sends an absolute image URL, because the renderer cannot fetch a relative path", () => {
    assert.match(service, /imageUrl: `\$\{assetBaseUrl\}/);
    assert.match(service, /function resolveAssetBaseUrl\(/);
  });

  it("sends the charged figures, not just the RON ones", () => {
    for (const field of ["chargedSubtotal", "chargedShippingCost", "chargedTax", "chargedTotal",
                          "currencyCode", "exchangeRate", "conversionFeePercent"]) {
      assert.match(service, new RegExp(`${field}:`), `invoice payload is missing ${field}`);
    }
  });

  it("the contract now enforces items, images and charged totals", () => {
    assert.match(contracts, /assertString\(payload\.currencyCode/);
    assert.match(contracts, /assertNumber\(payload\.chargedTotal/);
    assert.match(contracts, /must be a site-relative path/);
  });

  it("rejects an absolute image URL at the contract boundary", () => {
    // Defence in depth: the service already normalises, so this catches a future caller
    // that does not.
    assert.match(contracts, /invoice request\.items\[\$\{index\}\]\.image must be a site-relative path/);
  });
});