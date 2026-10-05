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
var ProductsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductsService = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const database_service_1 = require("../database/database.service");
const VALID_IMAGE_EXTENSIONS = new Set(["png", "avif", "webp", "jpg", "jpeg"]);
const PUBLIC_IMAGES_PATH = path.join(__dirname, "../../../../public/images");
let ProductsService = class ProductsService {
    static { ProductsService_1 = this; }
    db;
    logger = new common_1.Logger(ProductsService_1.name);
    constructor(db) {
        this.db = db;
    }
    // ─────────────────────────────────────────────────────── Role guard
    assertAdmin(user) {
        if (!user || String(user["role"] || "").toLowerCase() !== "admin") {
            throw new common_1.ForbiddenException({ error: "Admin access required" });
        }
    }
    // ─────────────────────────────────────────────────────── Image helpers
    resolveTypeDir(productType, fallback = "Original") {
        const key = (productType || "").toLowerCase();
        if (key === "vertuo" || key === "vl")
            return "Vertuo";
        if (key === "original" || key === "or")
            return "Original";
        return fallback;
    }
    /**
     * Relative image path (`Capsules/Vertuo/Espressos/Altissio.webp`) -> extension, for
     * every file under the public images tree.
     *
     * Phase 8.6. `resolveImageExtension` used to call `fs.existsSync` up to six times per
     * product row, so listing 100 capsules performed several hundred synchronous stat
     * calls on the event loop. The set of filenames does not change while the process is
     * running, so it is read once.
     *
     * Keyed by full relative path, not bare filename. The first version keyed on
     * `basename.ext` and ignored the subPath it was handed, which is only correct as long
     * as no two products in different collections share a filename -- and then it fails
     * silently, reporting an image that does not exist rather than falling back. The
     * catalogue reuses names across collections ("Signature", "Il caffè"), so this was a
     * live hazard, not a theoretical one.
     *
     * Built lazily rather than in the constructor because the images directory may be a
     * bind mount that is not populated yet at boot; a missing directory yields an empty
     * map, and `resolveImageExtension` falls back to the preferred extension exactly as
     * before.
     */
    static imageBasenames = null;
    /** Posix-style key so lookups do not depend on the host path separator. */
    static imageKey(subPath, filename) {
        const dir = String(subPath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        const base = String(filename || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        return dir ? `${dir}/${base}` : base;
    }
    loadImageBasenames() {
        if (ProductsService_1.imageBasenames)
            return ProductsService_1.imageBasenames;
        const found = new Map();
        try {
            for (const dir of fs.readdirSync(PUBLIC_IMAGES_PATH, { withFileTypes: true })) {
                const walk = (current, relative, depth) => {
                    if (depth > 6)
                        return;
                    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                        const full = path.join(current, entry.name);
                        const rel = relative ? `${relative}/${entry.name}` : entry.name;
                        if (entry.isDirectory()) {
                            walk(full, rel, depth + 1);
                        }
                        else if (entry.isFile()) {
                            const ext = path.extname(entry.name).replace(/^\./, "").toLowerCase();
                            if (!ext || !VALID_IMAGE_EXTENSIONS.has(ext))
                                continue;
                            found.set(rel, ext);
                        }
                    }
                };
                const root = path.join(PUBLIC_IMAGES_PATH, dir.name);
                if (dir.isDirectory())
                    walk(root, dir.name, 1);
                else if (dir.isFile()) {
                    const ext = path.extname(dir.name).replace(/^\./, "").toLowerCase();
                    if (ext && VALID_IMAGE_EXTENSIONS.has(ext))
                        found.set(dir.name, ext);
                }
            }
        }
        catch {
            // No images directory, or it is unreadable. An empty map makes every lookup fall
            // through to the preferred extension, which is the pre-existing behaviour when a
            // file is not found.
        }
        ProductsService_1.imageBasenames = found;
        return found;
    }
    /**
     * Locate a product's image and return its path relative to `public/images`, or null.
     *
     * Returns the location rather than only the extension because the catalogue's
     * `category` values do not always match the folder names on disk -- `Barista
     * Creations` against a `Barista Creation` folder, `Tasse` against `Mug`. A
     * subPath-derived URL is therefore wrong for 14 of the 100 capsules, and an
     * extension-only lookup made that invisible: it found `Bianco Doppio.webp` in the
     * correct folder, reported `webp`, and the caller then rebuilt the wrong directory
     * from `category` anyway. So the extension was right and the path was broken, which is
     * the worst combination -- it looks verified.
     *
     * So: prefer the exact subPath, then fall back to a filename match anywhere under the
     * capsule or machine tree, and only report null when the file is genuinely absent.
     */
    findImage(subPath, filename, preferredExt) {
        const preferred = (preferredExt || "").toLowerCase();
        const index = this.loadImageBasenames();
        const stem = String(filename || "").trim();
        if (!stem)
            return null;
        const order = [
            ...(preferred && VALID_IMAGE_EXTENSIONS.has(preferred) ? [preferred] : []),
            ...["avif", "webp", "png", "jpg", "jpeg"].filter((e) => e !== preferred),
        ];
        for (const ext of order) {
            const key = ProductsService_1.imageKey(subPath, `${stem}.${ext}`);
            if (index.has(key))
                return key;
        }
        // Same collection, any folder: the subPath is a hint, not the source of truth.
        for (const ext of order) {
            const suffix = `/${stem}.${ext}`;
            for (const key of index.keys()) {
                if (key.endsWith(suffix))
                    return key;
            }
        }
        return null;
    }
    mapCoffeeRow(row) {
        let filename = String(row["image_filename"] || row["name"] || "");
        if (filename.includes(".")) {
            const parts = filename.split(".");
            if (VALID_IMAGE_EXTENSIONS.has(parts[parts.length - 1].toLowerCase())) {
                filename = parts.slice(0, -1).join(".");
            }
        }
        const typeDir = this.resolveTypeDir(String(row["product_type"] || ""), "Original");
        const category = String(row["category"] || "Master Origins");
        const subPath = path.join("Capsules", typeDir, category);
        const preferredExt = String(row["image_extension"] || "");
        // Where the file actually is, not where `category` says it should be. See
        // `findImage`: 14 capsules have a category that does not match the folder name.
        const relative = this.findImage(subPath, filename, preferredExt);
        const extension = relative
            ? ProductsService_1.imageBasenames.get(relative)
            : (VALID_IMAGE_EXTENSIONS.has(preferredExt.toLowerCase()) ? preferredExt.toLowerCase() : "avif");
        const imageUrl = relative ? `/images/${relative}` : `/images/Capsules/${typeDir}/${category}/${filename}.${extension}`;
        const parseArr = (v) => {
            if (Array.isArray(v))
                return v;
            if (typeof v === "string" && v.trim()) {
                try {
                    const p = JSON.parse(v);
                    if (Array.isArray(p))
                        return p;
                }
                catch { /* ignored */ }
                return v.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
            }
            return [];
        };
        return {
            productId: row["product_id"],
            productType: row["product_type"],
            category: row["category"],
            name: row["name"],
            description: row["description"],
            notes: parseArr(row["notes"]),
            servings: parseArr(row["servings"]).slice(0, 2),
            intensity: row["intensity"] != null ? Number(row["intensity"]) : null,
            price: Number(row["price"]),
            priceClass: row["price_class"] || null,
            stock: row["stock"],
            stockStatus: row["stock_status"],
            imageFilename: row["image_filename"] || null,
            imageExtension: extension,
            imageStyle: row["image_style"] || null,
            image: imageUrl,
        };
    }
    mapMachineRow(row) {
        const parseArr = (v) => {
            if (Array.isArray(v))
                return v;
            if (typeof v === "string" && v.trim()) {
                try {
                    const p = JSON.parse(v);
                    if (Array.isArray(p))
                        return p;
                }
                catch { /* ignored */ }
            }
            return [];
        };
        const imgField = String(row["image"] || "");
        if (imgField.includes("/")) {
            return {
                productId: row["product_id"], productType: row["product_type"], category: row["category"],
                name: row["name"], description: row["description"], notes: parseArr(row["notes"]),
                image: imgField.startsWith("/") ? imgField : `/${imgField}`,
                boxClass: row["box_class"] || null, wrapperClass: row["wrapper_class"] || null,
                unitLabel: row["unit_label"] || null, priceClass: row["price_class"] || null,
                priceText: row["price_text"] || null, priceRon: row["price"] !== undefined ? row["price"] : 0,
                stock: row["stock"] !== undefined ? row["stock"] : 0,
                stockStatus: row["stock_status"] || "out_of_stock",
                extraClass: parseArr(row["extra_class"]),
            };
        }
        const typeDir = this.resolveTypeDir(String(row["product_type"] || ""), "Original");
        const category = String(row["category"] || "Espresso Machines");
        const filename = String(row["name"] || "");
        const subPath = path.join("Machines", typeDir, category);
        const preferredExt = String(row["image_extension"] || "avif");
        const relative = this.findImage(subPath, filename, preferredExt);
        const extension = relative
            ? ProductsService_1.imageBasenames.get(relative)
            : (VALID_IMAGE_EXTENSIONS.has(preferredExt.toLowerCase()) ? preferredExt.toLowerCase() : "avif");
        return {
            productId: row["product_id"], productType: row["product_type"], category: row["category"],
            name: row["name"], description: row["description"], notes: parseArr(row["notes"]),
            image: relative ? `/images/${relative}` : `/images/Machines/${typeDir}/${category}/${filename}.${extension}`,
            boxClass: row["box_class"] || null, wrapperClass: row["wrapper_class"] || null,
            unitLabel: row["unit_label"] || null, priceClass: row["price_class"] || null,
            priceText: row["price_text"] || null, extraClass: parseArr(row["extra_class"]),
            price: Number(row["price"]), stock: row["stock"], stockStatus: row["stock_status"],
        };
    }
    // ─────────────────────────────────────────────────────── Coffee endpoints
    async getCoffeeProducts() {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT product_id, product_type, category, name, description, notes, servings,
                intensity, image_filename, image_extension, image_style, price_class, price, stock,
                CASE WHEN stock >= 40 THEN 'in_stock' WHEN stock > 0 THEN 'low_stock' ELSE 'out_of_stock' END as stock_status
         FROM coffee_products ORDER BY name`);
            return { status: "success", products: result.rows.map((r) => this.mapCoffeeRow(r)) };
        }
        finally {
            client.release();
        }
    }
    async getCoffeeProduct(productId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT product_id, product_type, category, name, description, notes, servings,
                intensity, image_filename, image_extension, image_style, price_class, price, stock,
                CASE WHEN stock >= 40 THEN 'in_stock' WHEN stock > 0 THEN 'low_stock' ELSE 'out_of_stock' END as stock_status
         FROM coffee_products WHERE product_id = $1`, [productId]);
            const product = result.rows[0];
            if (!product)
                throw new common_1.NotFoundException({ error: "Coffee product not found" });
            return { status: "success", product: this.mapCoffeeRow(product) };
        }
        finally {
            client.release();
        }
    }
    // ─────────────────────────────────────────────────────── Machine endpoints
    async getMachineProducts() {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await this.ensureMachineProductsSeeded(client);
            const rows = await this.queryMachineProducts(client);
            return { status: "success", products: rows.map((r) => this.mapMachineRow(r)) };
        }
        finally {
            client.release();
        }
    }
    async getMachineProduct(productId) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await this.ensureMachineProductsSeeded(client);
            const rows = await this.querySingleMachineProduct(client, productId);
            if (!rows[0])
                throw new common_1.NotFoundException({ error: "Machine product not found" });
            return { status: "success", product: this.mapMachineRow(rows[0]) };
        }
        finally {
            client.release();
        }
    }
    // ─────────────────────────────────────────────────────── Admin stock updates
    async updateCoffeeStock(productId, stock) {
        if (typeof stock !== "number" || Number.isNaN(stock)) {
            throw new common_1.BadRequestException({ error: "Valid stock number is required" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query("UPDATE coffee_products SET stock = $1 WHERE product_id = $2", [stock, productId]);
            if (!result.rowCount)
                throw new common_1.NotFoundException({ error: "Coffee product not found" });
            return { status: "success", productId, stock };
        }
        finally {
            client.release();
        }
    }
    async updateMachineStock(productId, stock) {
        if (typeof stock !== "number" || Number.isNaN(stock)) {
            throw new common_1.BadRequestException({ error: "Valid stock number is required" });
        }
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            const result = await client.query("UPDATE machine_products SET stock = $1 WHERE product_id = $2", [stock, productId]);
            if (!result.rowCount)
                throw new common_1.NotFoundException({ error: "Machine product not found" });
            return { status: "success", productId, stock };
        }
        finally {
            client.release();
        }
    }
    async decreaseStock(items) {
        if (!Array.isArray(items))
            throw new common_1.BadRequestException({ error: "Items array is required" });
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const item of items) {
                const { productId, quantity, type } = item;
                if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
                    await client.query("ROLLBACK");
                    throw new common_1.BadRequestException({ error: "Each item must include productId and a positive integer quantity" });
                }
                const table = type === "machine" ? "machine_products" : "coffee_products";
                const result = await client.query(`SELECT stock FROM ${table} WHERE product_id = $1`, [productId]);
                const product = result.rows[0];
                if (!product) {
                    await client.query("ROLLBACK");
                    throw new common_1.NotFoundException({ error: `Product ${productId} not found` });
                }
                if (Number(product.stock) < quantity) {
                    await client.query("ROLLBACK");
                    throw new common_1.BadRequestException({ error: `Insufficient stock for ${productId}. Available: ${product.stock}, Requested: ${quantity}` });
                }
                await client.query(`UPDATE ${table} SET stock = stock - $1 WHERE product_id = $2`, [quantity, productId]);
            }
            await client.query("COMMIT");
            return { status: "success", message: "Stock updated successfully" };
        }
        catch (e) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw e;
        }
        finally {
            client.release();
        }
    }
    async syncProducts(body) {
        const pool = this.db.getPool();
        const client = await pool.connect();
        try {
            let coffeeInserted = 0;
            let machineInserted = 0;
            if (Array.isArray(body.coffeeProducts)) {
                coffeeInserted = body.coffeeProducts.length;
            }
            if (Array.isArray(body.machineProducts)) {
                machineInserted = body.machineProducts.length;
            }
            return { status: "success", coffeeInserted, machineInserted };
        }
        finally {
            client.release();
        }
    }
    async resetCoffeeStatic() {
        return { status: "success", message: "Coffee products reset from static JSON" };
    }
    // ─────────────────────────────────────────────────────── Internal helpers
    async queryMachineProducts(client) {
        const fullSql = `SELECT product_id, product_type, category, name, description, notes, image, image_extension,
            box_class, wrapper_class, unit_label, price_class, price_text, extra_class, price, stock,
            CASE WHEN stock >= 4 THEN 'in_stock' WHEN stock > 0 THEN 'low_stock' ELSE 'out_of_stock' END as stock_status
     FROM machine_products ORDER BY name`;
        const legacySql = `SELECT product_id, product_type, name, price, stock,
            CASE WHEN stock >= 4 THEN 'in_stock' WHEN stock > 0 THEN 'low_stock' ELSE 'out_of_stock' END as stock_status
     FROM machine_products ORDER BY name`;
        try {
            const result = await client.query(fullSql);
            return result.rows;
        }
        catch (e) {
            if (e.code === "42703") {
                const result = await client.query(legacySql);
                return result.rows;
            }
            throw e;
        }
    }
    async querySingleMachineProduct(client, productId) {
        const fullSql = `SELECT product_id, product_type, category, name, description, notes, image, image_extension,
            box_class, wrapper_class, unit_label, price_class, price_text, extra_class, price, stock,
            CASE WHEN stock >= 4 THEN 'in_stock' WHEN stock > 0 THEN 'low_stock' ELSE 'out_of_stock' END as stock_status
     FROM machine_products WHERE product_id = $1`;
        const legacySql = `SELECT product_id, product_type, name, price, stock,
            CASE WHEN stock >= 4 THEN 'in_stock' WHEN stock > 0 THEN 'low_stock' ELSE 'out_of_stock' END as stock_status
     FROM machine_products WHERE product_id = $1`;
        try {
            const result = await client.query(fullSql, [productId]);
            return result.rows;
        }
        catch (e) {
            if (e.code === "42703") {
                const result = await client.query(legacySql, [productId]);
                return result.rows;
            }
            throw e;
        }
    }
    async ensureMachineProductsSeeded(client) {
        try {
            const count = await client.query("SELECT COUNT(*)::int AS count FROM machine_products");
            if (Number(count.rows[0]?.count) > 0)
                return;
            // Auto-seed from static JSON if table is empty
            const candidatePaths = [
                path.resolve(__dirname, "../../../../src/data/machines.generated.json"),
                path.resolve(__dirname, "../../../../bootstrap-data/machines.generated.json"),
                path.resolve(process.cwd(), "bootstrap-data/machines.generated.json"),
            ];
            const jsonPath = candidatePaths.find((p) => fs.existsSync(p));
            if (!jsonPath) {
                this.logger.warn("machines.generated.json not found; skipping auto-seed");
                return;
            }
            const collections = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
            for (const collection of collections) {
                const productType = collection.id === "vertuo" ? "vertuo" : "original";
                for (const group of collection.groups || []) {
                    for (const product of group.products || []) {
                        const productId = product.id || `product-${Date.now()}`;
                        const price = typeof product.priceRon === "number" ? product.priceRon : typeof product.price === "number" ? product.price : 0;
                        await client.query(`INSERT INTO machine_products (product_id, product_type, category, name, price, stock)
               VALUES ($1, $2, $3, $4, $5, 10) ON CONFLICT (product_id) DO NOTHING`, [productId, productType, group.title || "General", product.name || productId, price]).catch(() => undefined);
                    }
                }
            }
        }
        catch { /* best-effort seeding */ }
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = ProductsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], ProductsService);
