/**
 * Products Routes
 * GET /api/products/coffee - Get all coffee products with stock
 * GET /api/products/coffee/:id - Get single coffee product
 * GET /api/products/machines - Get all machine products with stock
 * GET /api/products/machines/:id - Get single machine product
 * PUT /api/products/coffee/:id/stock - Update coffee stock (admin)
 * PUT /api/products/machines/:id/stock - Update machine stock (admin)
 * POST /api/products/decrease-stock - Decrease stock for order items
 * POST /api/products/sync - Sync products from payload
 * POST /api/products/coffee/reset-static - Repopulate coffee_products from static JSON
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const pool = require("../db/connection");

const router = express.Router();

const VALID_IMAGE_EXTENSIONS = new Set(["png", "avif", "webp", "jpg", "jpeg"]);
const PUBLIC_IMAGES_PATH = path.join(__dirname, "../../public/images");

function resolveTypeDir(productType, fallback = "Original") {
	const key = (productType || "").toString().trim().toLowerCase();
	if (key === "vertuo" || key === "vl") return "Vertuo";
	if (key === "original" || key === "or") return "Original";
	// If already provided as directory-style value
	if ((productType || "") === "Vertuo") return "Vertuo";
	if ((productType || "") === "Original") return "Original";
	return fallback;
}

// Map user-facing category to folder name (mirrors frontend logic)
const CATEGORY_FOLDER_MAP = {
	original: {
		"coffee+": "Coffee+",
		"craft brew": "Craft Brew",
		"creations barista": "Barista Creations",
		"barista creations": "Barista Creations",
		espresso: "Espresso",
		espressos: "Espresso",
		"édition limitée": "Limited Edition",
		"edition limitee": "Limited Edition",
		"limited edition": "Limited Edition",
		"ispirazione italiana": "Ispirazione Italiana",
		"italian explorations": "Italian Explorations",
		"origines principales": "Master Origins",
		"master origins": "Master Origins",
		"explorations du monde": "World Explorations",
		"world explorations": "World Explorations",
		tasse: "Mug",
		mug: "Mug",
	},
	vertuo: {
		"coffee+": "Coffee+",
		"craft brew": "Craft Brew",
		"double espresso": "Double Espresso",
		espresso: "Espressos",
		espressos: "Espressos",
		"gran lungo": "Gran Lungo",
		"édition limitée": "Limited Edition",
		"edition limitee": "Limited Edition",
		"limited edition": "Limited Edition",
		"barista creation": "Barista Creation",
		"barista creations": "Barista Creation",
		"creations barista": "Barista Creation",
		"master origins": "Master Origins",
		"origines principales": "Master Origins",
		mug: "Mug",
		tasse: "Mug",
	},
};

const normalizeKey = (value) =>
	(value || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[^a-z0-9\s]/g, "")
		.trim();

const resolveCategoryFolder = (productType, category) => {
	const typeKey = (productType || "").toLowerCase() === "vertuo" ? "vertuo" : "original";
	const catKey = normalizeKey(category);
	return CATEGORY_FOLDER_MAP[typeKey]?.[catKey] || category || "General";
};

// Machine group titles are user-facing (often French) but folders are English.
// Map them to the actual folder names under public/images/Machines/<Type>/...
const MACHINE_CATEGORY_FOLDER_MAP = {
	original: {
		"forfaits speciaux": "Special Packs",
		"special packs": "Special Packs",
		espressors: "Espresso Machines",
		"espresso machines": "Espresso Machines",
		"machines a espresso": "Espresso Machines",
		"machines a espresso avec du lait": "Espresso Machines Latte",
		"espresso machines latte": "Espresso Machines Latte",
	},
	vertuo: {
		"forfaits speciaux": "Special Packs",
		"special packs": "Special Packs",
		"espresso machines": "Espresso Machines",
		"machines a espresso": "Espresso Machines",
		"machines a espresso avec du lait": "Espresso Machines Latte",
		"espresso machines latte": "Espresso Machines Latte",
	},
};

const resolveMachineCategoryFolder = (productType, category) => {
	const typeKey = (productType || "").toString().trim().toLowerCase() === "vertuo" ? "vertuo" : "original";
	const catKey = normalizeKey(category);
	return MACHINE_CATEGORY_FOLDER_MAP[typeKey]?.[catKey] || category || "General";
};

function resolveImageExtension(subPath, filename, preferredExt) {
	// If DB has a specific extension, use it only if the file actually exists.
	const preferred = (preferredExt || "").toString().trim().toLowerCase();
	if (preferred && VALID_IMAGE_EXTENSIONS.has(preferred)) {
		const fullPathPreferred = path.join(PUBLIC_IMAGES_PATH, subPath, `${filename}.${preferred}`);
		if (fs.existsSync(fullPathPreferred)) {
			return preferred;
		}
	}

	// Otherwise, check file system for existence (and also acts as fallback if preferred doesn't exist)
	const extensionsToCheck = ["avif", "webp", "png", "jpg", "jpeg"];
	for (const ext of extensionsToCheck) {
		const fullPath = path.join(PUBLIC_IMAGES_PATH, subPath, `${filename}.${ext}`);
		if (fs.existsSync(fullPath)) {
			return ext;
		}
	}

	return "png"; // Default fallback
}

async function columnExists(client, table, column) {
	const res = await client.query(
		`SELECT 1
		 FROM information_schema.columns
		 WHERE table_schema = 'public'
		   AND table_name = $1
		   AND column_name = $2
		 LIMIT 1`,
		[table, column]
	);
	return res.rows.length > 0;
}

async function indexExists(client, table, indexName) {
	const res = await client.query(
		`SELECT 1
		 FROM pg_indexes
		 WHERE schemaname = 'public'
		   AND tablename = $1
		   AND indexname = $2
		 LIMIT 1`,
		[table, indexName]
	);
	return res.rows.length > 0;
}

async function ensureColumn(client, table, column, addSql) {
	if (await columnExists(client, table, column)) return;
	const cleanSql = addSql.replace(/`/g, "");
	await client.query(`ALTER TABLE ${table} ADD COLUMN ${cleanSql}`);
}

async function ensureIndex(client, table, indexName, addSql) {
	if (await indexExists(client, table, indexName)) return;
	const cleanSql = addSql.replace(/`/g, "");
	// PostgreSQL uses CREATE INDEX instead of ALTER TABLE ADD INDEX
	if (cleanSql.toUpperCase().includes("INDEX")) {
		const createSql = cleanSql.replace(/INDEX\s+(\w+)\s+\((.+)\)/i, `CREATE INDEX $1 ON ${table} ($2)`);
		await client.query(createSql);
	} else {
		await client.query(`ALTER TABLE ${table} ADD ${cleanSql}`);
	}
}

async function ensureCoffeeProductsSchema(client) {
	// Ensure metadata columns exist so JSON import can populate them
	await ensureColumn(client, "coffee_products", "image_filename", "image_filename VARCHAR(255) NULL");
	await ensureColumn(client, "coffee_products", "image_extension", "image_extension VARCHAR(10) NULL DEFAULT 'png'");
	await ensureColumn(client, "coffee_products", "image_style", "image_style VARCHAR(255) NULL");
	await ensureColumn(client, "coffee_products", "price_class", "price_class VARCHAR(50) NULL");
}

async function ensureMachineProductsSchema(client) {
	// Ensure machine metadata columns exist so JSON import can populate them
	await ensureColumn(client, "machine_products", "category", "category VARCHAR(255) NOT NULL DEFAULT 'General'");
	await ensureColumn(client, "machine_products", "description", "description TEXT NULL");
	await ensureColumn(client, "machine_products", "notes", "notes JSONB NULL");
	await ensureColumn(client, "machine_products", "image", "image VARCHAR(255) NULL");
	await ensureColumn(client, "machine_products", "image_extension", "image_extension VARCHAR(10) NULL DEFAULT 'avif'");
	await ensureColumn(client, "machine_products", "box_class", "box_class VARCHAR(255) NULL");
	await ensureColumn(client, "machine_products", "wrapper_class", "wrapper_class VARCHAR(255) NULL");
	await ensureColumn(client, "machine_products", "unit_label", "unit_label VARCHAR(255) NULL");
	await ensureColumn(client, "machine_products", "price_class", "price_class VARCHAR(50) NULL");
	await ensureColumn(client, "machine_products", "price_text", "price_text VARCHAR(255) NULL");
	await ensureColumn(client, "machine_products", "extra_class", "extra_class JSONB NULL");
	await ensureIndex(client, "machine_products", "idx_category", "INDEX idx_category (category)");
}

function slugifyProductId(name, fallback = "") {
	const source = (name || fallback || "").toString().trim();
	const slug = source
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")
		.replace(/-{2,}/g, "-");
	return slug || `product-${Date.now()}`;
}

function safeJsonParse(value, fallback = null) {
	try {
		return JSON.parse(value);
	} catch (err) {
		return fallback;
	}
}

function parseNotes(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return [];
		const parsed = safeJsonParse(trimmed, null);
		if (Array.isArray(parsed)) return parsed;
		// Fallback: split comma/semicolon separated text
		return trimmed
			.split(/[;,]/)
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return [];
}

function parseServings(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return [];
		const parsed = safeJsonParse(trimmed, null);
		if (Array.isArray(parsed)) return parsed;
	}
	return [];
}

function normalizeServings(servings) {
	if (!Array.isArray(servings)) return null;
	return servings.slice(0, 2);
}

function normalizeImageMeta(imageField, extensionField) {
	const filename = typeof imageField === "string" ? imageField.split("/").pop() : null;
	const extFromName = filename && filename.includes(".") ? filename.split(".").pop().toLowerCase() : null;
	const normalizedExtSource = (extensionField || extFromName || "").toLowerCase();
	const extension = VALID_IMAGE_EXTENSIONS.has(normalizedExtSource) ? normalizedExtSource : "png";
	return { filename, extension };
}

function mapCoffeeRow(row) {
	const notes = parseNotes(row.notes);
	const servings = parseServings(row.servings);

	let filename = row.image_filename || row.name;
	// Remove extension if present in filename to avoid double extension
	if (filename && filename.includes(".")) {
		const parts = filename.split(".");
		if (VALID_IMAGE_EXTENSIONS.has(parts[parts.length - 1].toLowerCase())) {
			filename = parts.slice(0, -1).join(".");
		}
	}

	const typeDir = resolveTypeDir(row.product_type, "Original");
	const category = row.category || "Master Origins";
	const categoryDir = resolveCategoryFolder(row.product_type, category);

	// Resolve extension by checking file system if not explicit
	const subPath = path.join("Capsules", typeDir, categoryDir);
	const extension = resolveImageExtension(subPath, filename, row.image_extension);

	const imageUrl = `/images/Capsules/${typeDir}/${categoryDir}/${filename}.${extension}`;

	return {
		productId: row.product_id,
		productType: row.product_type,
		category: row.category,
		name: row.name,
		description: row.description,
		notes: Array.isArray(notes) ? notes : [],
		servings: Array.isArray(servings) ? servings.slice(0, 2) : [],
		intensity: row.intensity !== null && row.intensity !== undefined ? Number(row.intensity) : null,
		price: Number(row.price),
		priceClass: row.price_class || null,
		stock: row.stock,
		stockStatus: row.stock_status,
		imageFilename: row.image_filename || null,
		imageExtension: extension,
		imageStyle: row.image_style || null,
		image: imageUrl,
	};
}

function mapMachineRow(row) {
	const notes = parseNotes(row.notes);
	const extraClass = parseNotes(row.extra_class);

	const typeDir = resolveTypeDir(row.product_type, "Original");
	const category = row.category || "Espresso Machines";
	const categoryDir = resolveMachineCategoryFolder(row.product_type, category);

	// Prefer a DB-provided image filename (or legacy imported image path) over product name.
	let filename = row.image || row.name;
	if (typeof filename === "string" && filename.includes("/")) {
		filename = filename.split("/").pop();
	}
	// Extract extension from legacy image field if present
	let extFromImage = null;
	if (typeof filename === "string" && filename.includes(".")) {
		const parts = filename.split(".");
		const extCandidate = parts[parts.length - 1].toLowerCase();
		if (VALID_IMAGE_EXTENSIONS.has(extCandidate)) {
			extFromImage = extCandidate;
			filename = parts.slice(0, -1).join(".");
		}
	}

	const subPath = path.join("Machines", typeDir, categoryDir);
	const extension = resolveImageExtension(subPath, filename, row.image_extension || extFromImage || "avif");

	const imageUrl = `/images/Machines/${typeDir}/${categoryDir}/${filename}.${extension}`;

	return {
		productId: row.product_id,
		productType: row.product_type,
		category: row.category,
		name: row.name,
		description: row.description,
		notes: Array.isArray(notes) ? notes : [],
		image: imageUrl,
		boxClass: row.box_class || null,
		wrapperClass: row.wrapper_class || null,
		unitLabel: row.unit_label || null,
		priceClass: row.price_class || null,
		priceText: row.price_text || null,
		extraClass: Array.isArray(extraClass) ? extraClass : [],
		price: Number(row.price),
		stock: row.stock,
		stockStatus: row.stock_status,
	};
}

// Get all coffee products
router.get("/coffee", async (req, res) => {
	try {
		const client = await pool.connect();
		try {
			const result = await client.query(
				`SELECT product_id, product_type, category, name, description, notes, servings, intensity, image_filename, image_extension, image_style, price_class, price, stock,
        CASE 
            WHEN stock >= 40 THEN 'in_stock'
            WHEN stock > 0 THEN 'low_stock'
            ELSE 'out_of_stock'
        END as stock_status
 FROM coffee_products
 ORDER BY name`
			);

			res.json({
				status: "success",
				products: result.rows.map(mapCoffeeRow),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get coffee products error:", error);
		res.status(500).json({ error: "Failed to get coffee products" });
	}
});

// Get single coffee product
router.get("/coffee/:productId", async (req, res) => {
	try {
		const { productId } = req.params;
		const client = await pool.connect();
		try {
			const result = await client.query(
				`SELECT product_id, product_type, category, name, description, notes, servings, intensity, image_filename, image_extension, image_style, price_class, price, stock,
        CASE 
            WHEN stock >= 40 THEN 'in_stock'
            WHEN stock > 0 THEN 'low_stock'
            ELSE 'out_of_stock'
        END as stock_status
 FROM coffee_products
 WHERE product_id = $1`,
				[productId]
			);

			const product = result.rows[0];

			if (!product) return res.status(404).json({ error: "Coffee product not found" });

			res.json({ status: "success", product: mapCoffeeRow(product) });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get coffee product error:", error);
		res.status(500).json({ error: "Failed to get coffee product" });
	}
});

async function queryMachineProducts(client) {
	// Prefer the expanded schema; fall back to legacy columns if the migration isn't applied yet
	const fullSelect = `SELECT product_id, product_type, category, name, description, notes, image, image_extension, box_class, wrapper_class, unit_label, price_class, price_text, extra_class, price, stock,
        CASE 
            WHEN stock >= 4 THEN 'in_stock'
            WHEN stock > 0 THEN 'low_stock'
            ELSE 'out_of_stock'
        END as stock_status
 FROM machine_products
 ORDER BY name`;

	const legacySelect = `SELECT product_id, product_type, name, price, stock,
        CASE 
            WHEN stock >= 4 THEN 'in_stock'
            WHEN stock > 0 THEN 'low_stock'
            ELSE 'out_of_stock'
        END as stock_status
 FROM machine_products
 ORDER BY name`;

	try {
		const result = await client.query(fullSelect);
		return result.rows;
	} catch (err) {
		if (err && (err.code === "42703" || err.message.includes("column"))) {
			console.warn("[Products] machine_products missing new columns; falling back to legacy select");
			const result = await client.query(legacySelect);
			return result.rows;
		}
		throw err;
	}
}

async function querySingleMachineProduct(client, productId) {
	const fullSelect = `SELECT product_id, product_type, category, name, description, notes, image, image_extension, box_class, wrapper_class, unit_label, price_class, price_text, extra_class, price, stock,
        CASE 
            WHEN stock >= 4 THEN 'in_stock'
            WHEN stock > 0 THEN 'low_stock'
            ELSE 'out_of_stock'
        END as stock_status
 FROM machine_products
 WHERE product_id = $1`;

	const legacySelect = `SELECT product_id, product_type, name, price, stock,
        CASE 
            WHEN stock >= 4 THEN 'in_stock'
            WHEN stock > 0 THEN 'low_stock'
            ELSE 'out_of_stock'
        END as stock_status
 FROM machine_products
 WHERE product_id = $1`;

	try {
		const result = await client.query(fullSelect, [productId]);
		return result.rows;
	} catch (err) {
		if (err && (err.code === "42703" || err.message.includes("column"))) {
			console.warn("[Products] machine_products missing new columns; falling back to legacy select (single)");
			const result = await client.query(legacySelect, [productId]);
			return result.rows;
		}
		throw err;
	}
}

// Get all machine products
router.get("/machines", async (req, res) => {
	try {
		const client = await pool.connect();
		try {
			const products = await queryMachineProducts(client);
			res.json({
				status: "success",
				products: products.map(mapMachineRow),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get machine products error:", error);
		res.status(500).json({ error: "Failed to get machine products" });
	}
});

// Get single machine product
router.get("/machines/:productId", async (req, res) => {
	try {
		const { productId } = req.params;
		const client = await pool.connect();
		try {
			const rows = await querySingleMachineProduct(client, productId);
			const product = rows[0];

			if (!product) return res.status(404).json({ error: "Machine product not found" });

			res.json({
				status: "success",
				product: mapMachineRow(product),
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get machine product error:", error);
		res.status(500).json({ error: "Failed to get machine product" });
	}
});

// Update coffee stock (admin)
router.put("/coffee/:productId/stock", async (req, res) => {
	const { productId } = req.params;
	const { stock } = req.body || {};
	if (typeof stock !== "number" || Number.isNaN(stock)) {
		return res.status(400).json({ error: "Valid stock number is required" });
	}

	try {
		const client = await pool.connect();
		try {
			const result = await client.query("UPDATE coffee_products SET stock = $1 WHERE product_id = $2", [stock, productId]);
			if (result.rowCount === 0) return res.status(404).json({ error: "Coffee product not found" });
			res.json({ status: "success", productId, stock });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Update coffee stock error:", error);
		res.status(500).json({ error: "Failed to update coffee stock" });
	}
});

// Update machine stock (admin)
router.put("/machines/:productId/stock", async (req, res) => {
	const { productId } = req.params;
	const { stock } = req.body || {};
	if (typeof stock !== "number" || Number.isNaN(stock)) {
		return res.status(400).json({ error: "Valid stock number is required" });
	}

	try {
		const client = await pool.connect();
		try {
			const result = await client.query("UPDATE machine_products SET stock = $1 WHERE product_id = $2", [stock, productId]);
			if (result.rowCount === 0) return res.status(404).json({ error: "Machine product not found" });
			res.json({ status: "success", productId, stock });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Update machine stock error:", error);
		res.status(500).json({ error: "Failed to update machine stock" });
	}
});

// Decrease stock for order items
router.post("/decrease-stock", async (req, res) => {
	try {
		const { items } = req.body;
		if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Items array is required" });

		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			for (const item of items) {
				const { productId, quantity, type } = item;
				const table = type === "machine" ? "machine_products" : "coffee_products";

				const result = await client.query(`SELECT stock FROM ${table} WHERE product_id = $1`, [productId]);
				const product = result.rows[0];
				if (!product) {
					await client.query("ROLLBACK");
					return res.status(404).json({ error: `Product ${productId} not found` });
				}

				if (product.stock < quantity) {
					await client.query("ROLLBACK");
					return res.status(400).json({
						error: `Insufficient stock for ${productId}. Available: ${product.stock}, Requested: ${quantity}`,
					});
				}

				await client.query(`UPDATE ${table} SET stock = stock - $1 WHERE product_id = $2`, [quantity, productId]);
			}

			await client.query("COMMIT");
			res.json({ status: "success", message: "Stock updated successfully" });
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Decrease stock error:", error);
		res.status(500).json({ error: "Failed to decrease stock" });
	}
});

// Sync products from JSON payload
router.post("/sync", async (req, res) => {
	try {
		const { coffeeProducts, machineProducts } = req.body || {};
		const client = await pool.connect();
		try {
			let coffeeInserted = 0;
			let machineInserted = 0;

			if (Array.isArray(coffeeProducts)) {
				await ensureCoffeeProductsSchema(client);
				for (const product of coffeeProducts) {
					const productId = slugifyProductId(product.name, product.id || product.product_id);
					const productTypeRaw = (
						product.productType ||
						product.product_type ||
						product.collectionId ||
						product.collection ||
						product.type ||
						""
					)
						.toString()
						.toLowerCase();
					const productType = productTypeRaw === "vertuo" ? "vertuo" : "original";
					const category = product.category || product.group || product.groupTitle || "General";
					const description = product.description || null;
					const notes = Array.isArray(product.notes) ? product.notes.slice(0, 8) : null;
					const servings = normalizeServings(product.servings);
					const intensity = typeof product.intensity === "number" ? product.intensity : null;
					const price =
						typeof product.priceRon === "number"
							? product.priceRon
							: typeof product.price === "number"
							? product.price
							: 0;
					const imageField = product.imageFilename || product.image || product.image_path;
					const imageExtField =
						product.imageExtension || product.image_extension || product.imageExt || product.image_format;
					const { filename, extension } = normalizeImageMeta(imageField, imageExtField);
					const priceClass = product.priceClass || product.price_class || null;
					const imageStyle = product.imageStyle || product.image_style || null;

					const result = await client.query(
						`INSERT INTO coffee_products (product_id, product_type, category, name, description, notes, servings, intensity, price, image_filename, image_extension, image_style, price_class, stock)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 100)
 ON CONFLICT (product_id) DO UPDATE SET
 product_type = EXCLUDED.product_type,
 category = EXCLUDED.category,
 name = EXCLUDED.name,
 description = EXCLUDED.description,
 notes = EXCLUDED.notes,
 servings = EXCLUDED.servings,
 intensity = EXCLUDED.intensity,
 price = EXCLUDED.price,
 image_filename = EXCLUDED.image_filename,
 image_extension = EXCLUDED.image_extension,
 image_style = EXCLUDED.image_style,
 price_class = EXCLUDED.price_class`,
						[
							productId,
							productType,
							category,
							product.name || productId,
							description,
							notes ? JSON.stringify(notes) : null,
							servings ? JSON.stringify(servings) : null,
							intensity,
							price,
							filename,
							extension,
							imageStyle,
							priceClass,
						]
					);
					if (result.rowCount > 0) coffeeInserted++;
				}
			}

			if (Array.isArray(machineProducts)) {
				await ensureMachineProductsSchema(client);
				for (const product of machineProducts) {
					const productId = product.id || product.product_id || slugifyProductId(product.name);
					const productTypeRaw = (product.productType || product.product_type || product.type || "")
						.toString()
						.toLowerCase();
					const productType = productTypeRaw === "vertuo" ? "vertuo" : "original";
					const category = product.category || product.group || product.groupTitle || product.collection || "General";
					const description = product.description || null;
					const notes = Array.isArray(product.notes) ? product.notes : null;
					const image = product.image || product.image_path || null;
					const boxClass = product.boxClass || product.box_class || null;
					const wrapperClass = product.wrapperClass || product.wrapper_class || null;
					const unitLabel = product.unitLabel || product.unit_label || null;
					const priceClass = product.priceClass || product.price_class || null;
					const priceText = product.priceText || product.price_text || null;
					const extraClass = Array.isArray(product.extraClass) ? product.extraClass : null;
					const price =
						typeof product.priceRon === "number"
							? product.priceRon
							: typeof product.price === "number"
							? product.price
							: 0;

					const result = await client.query(
						`INSERT INTO machine_products (product_id, product_type, category, name, description, notes, image, box_class, wrapper_class, unit_label, price_class, price_text, extra_class, price, stock)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 10)
 ON CONFLICT (product_id) DO UPDATE SET
 product_type = EXCLUDED.product_type,
 category = EXCLUDED.category,
 name = EXCLUDED.name,
 description = EXCLUDED.description,
 notes = EXCLUDED.notes,
 image = EXCLUDED.image,
 box_class = EXCLUDED.box_class,
 wrapper_class = EXCLUDED.wrapper_class,
 unit_label = EXCLUDED.unit_label,
 price_class = EXCLUDED.price_class,
 price_text = EXCLUDED.price_text,
 extra_class = EXCLUDED.extra_class,
 price = EXCLUDED.price`,
						[
							productId,
							productType,
							category,
							product.name || productId,
							description,
							notes ? JSON.stringify(notes) : null,
							image ? image.replace(/^\/+/, "") : null,
							boxClass,
							wrapperClass,
							unitLabel,
							priceClass,
							priceText,
							extraClass ? JSON.stringify(extraClass) : null,
							price,
						]
					);
					if (result.rowCount > 0) machineInserted++;
				}
			}

			res.json({
				status: "success",
				message: "Products synced successfully",
				coffeeInserted,
				machineInserted,
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Sync products error:", error);
		res.status(500).json({ error: "Failed to sync products" });
	}
});

// Reset coffee_products from static JSON
router.post("/coffee/reset-static", async (req, res) => {
	try {
		const jsonPath = path.resolve(__dirname, "../../src/data/coffee.generated.json");

		if (!fs.existsSync(jsonPath)) {
			return res.status(404).json({ error: "coffee.generated.json not found", path: jsonPath });
		}

		const rawData = fs.readFileSync(jsonPath, "utf8");
		const collections = JSON.parse(rawData);

		const client = await pool.connect();
		try {
			await ensureCoffeeProductsSchema(client);
			await client.query("DELETE FROM coffee_products");

			let inserted = 0;
			const errors = [];

			for (const collection of collections) {
				const productType = collection.id === "vertuo" ? "vertuo" : "original";

				for (const group of collection.groups || []) {
					const category = group.title || "General";

					for (const product of group.products || []) {
						try {
							const baseId = product.id || slugifyProductId(product.name);
							const productId = productType === "vertuo" ? `${baseId}-vl` : baseId;
							const description = product.description || null;
							const notes = Array.isArray(product.additionalDescriptions)
								? product.additionalDescriptions.slice(0, 8)
								: null;
							const servings = normalizeServings(product.servings);
							const intensity = typeof product.intensity === "number" ? product.intensity : null;
							const price =
								typeof product.priceRon === "number"
									? product.priceRon
									: typeof product.price === "number"
									? product.price
									: 0;
							const { filename, extension } = normalizeImageMeta(product.image, null);
							const priceClass = product.priceClass || product.price_class || null;
							const imageStyle = product.imageStyle || product.image_style || null;

							await client.query(
								`INSERT INTO coffee_products 
 (product_id, product_type, category, name, description, notes, servings, intensity, price, image_filename, image_extension, image_style, price_class, stock)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 100)
 ON CONFLICT (product_id) DO UPDATE SET
 product_type = EXCLUDED.product_type,
 category = EXCLUDED.category,
 name = EXCLUDED.name,
 description = EXCLUDED.description,
 notes = EXCLUDED.notes,
 servings = EXCLUDED.servings,
 intensity = EXCLUDED.intensity,
 price = EXCLUDED.price,
 image_filename = EXCLUDED.image_filename,
 image_extension = EXCLUDED.image_extension,
 image_style = EXCLUDED.image_style,
 price_class = EXCLUDED.price_class`,
								[
									productId,
									productType,
									category,
									product.name || productId,
									description,
									notes ? JSON.stringify(notes) : null,
									servings ? JSON.stringify(servings) : null,
									intensity,
									price,
									filename,
									extension,
									imageStyle,
									priceClass,
								]
							);
							inserted++;
						} catch (err) {
							errors.push({ product: product.name, error: err.message });
						}
					}
				}
			}

			res.json({
				status: "success",
				message: `Inserted/updated ${inserted} coffee products from static JSON`,
				inserted,
				errors: errors.length > 0 ? errors : undefined,
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Reset static coffee products error:", error);
		res.status(500).json({ error: "Failed to reset coffee products", details: error.message });
	}
});

// Reset machine_products from static JSON
router.post("/machines/reset-static", async (req, res) => {
	try {
		const jsonPath = path.resolve(__dirname, "../../src/data/machines.generated.json");

		if (!fs.existsSync(jsonPath)) {
			return res.status(404).json({ error: "machines.generated.json not found", path: jsonPath });
		}

		const rawData = fs.readFileSync(jsonPath, "utf8");
		const collections = JSON.parse(rawData);

		const client = await pool.connect();
		try {
			await ensureMachineProductsSchema(client);
			await client.query("DELETE FROM machine_products");

			let inserted = 0;
			const errors = [];

			for (const collection of collections) {
				const productType = collection.id === "vertuo" ? "vertuo" : "original";

				for (const group of collection.groups || []) {
					const category = group.title || "General";

					for (const product of group.products || []) {
						try {
							const productId = product.id || slugifyProductId(product.name);
							const description = product.description || null;
							const notes = Array.isArray(product.notes) ? product.notes : null;
							const image = product.image ? product.image.replace(/^\/+/, "") : null;
							const boxClass = product.boxClass || product.box_class || null;
							const wrapperClass = product.wrapperClass || product.wrapper_class || null;
							const unitLabel = product.unitLabel || product.unit_label || null;
							const priceClass = product.priceClass || product.price_class || null;
							const priceText = product.priceText || product.price_text || null;
							const extraClass = Array.isArray(product.extraClass) ? product.extraClass : null;
							const price =
								typeof product.priceRon === "number"
									? product.priceRon
									: typeof product.price === "number"
									? product.price
									: 0;

							await client.query(
								`INSERT INTO machine_products 
 (product_id, product_type, category, name, description, notes, image, box_class, wrapper_class, unit_label, price_class, price_text, extra_class, price, stock)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 10)
 ON CONFLICT (product_id) DO UPDATE SET
 product_type = EXCLUDED.product_type,
 category = EXCLUDED.category,
 name = EXCLUDED.name,
 description = EXCLUDED.description,
 notes = EXCLUDED.notes,
 image = EXCLUDED.image,
 box_class = EXCLUDED.box_class,
 wrapper_class = EXCLUDED.wrapper_class,
 unit_label = EXCLUDED.unit_label,
 price_class = EXCLUDED.price_class,
 price_text = EXCLUDED.price_text,
 extra_class = EXCLUDED.extra_class,
 price = EXCLUDED.price`,
								[
									productId,
									productType,
									category,
									product.name || productId,
									description,
									notes ? JSON.stringify(notes) : null,
									image,
									boxClass,
									wrapperClass,
									unitLabel,
									priceClass,
									priceText,
									extraClass ? JSON.stringify(extraClass) : null,
									price,
								]
							);
							inserted++;
						} catch (err) {
							errors.push({ product: product.name, error: err.message });
						}
					}
				}
			}

			res.json({
				status: "success",
				message: `Inserted/updated ${inserted} machine products from static JSON`,
				inserted,
				errors: errors.length > 0 ? errors : undefined,
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Reset static machine products error:", error);
		res.status(500).json({ error: "Failed to reset machine products", details: error.message });
	}
});

module.exports = router;
