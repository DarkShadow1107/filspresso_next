/**
 * Admin Routes
 * POST /api/admin/login - Admin login
 * GET /api/admin/tables - Get all tables
 * GET /api/admin/tables/:table - Get table columns and data
 * POST /api/admin/tables/:table - Insert row
 * PUT /api/admin/tables/:table/:id - Update row
 * DELETE /api/admin/tables/:table/:id - Delete row
 * GET /api/admin/table-info/:table - Get table schema info
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const bcrypt = require("bcrypt");
const pool = require("../db/connection");

const router = express.Router();

const VALID_IMAGE_EXTENSIONS = new Set(["png", "avif", "webp", "jpg", "jpeg", "svg"]);

const isAllowedImage = (file) => {
	const ext = path
		.extname(file.originalname || "")
		.toLowerCase()
		.replace(".", "");
	const mime = (file.mimetype || "").toLowerCase();
	if (VALID_IMAGE_EXTENSIONS.has(ext)) return true;
	// Extra safety: allow based on mimetype even if extension casing is odd
	if (
		mime.includes("image/avif") ||
		mime.includes("image/webp") ||
		mime.includes("image/png") ||
		mime.includes("jpeg") ||
		mime.includes("image/svg+xml")
	) {
		return true;
	}
	return false;
};

// Admin credentials (hardcoded as per requirement)
const ADMIN_USERNAME = "Admin";
const ADMIN_PASSWORD = "FilspressoNext";

// Simple session store for admin tokens (in production use Redis or similar)
const adminSessions = new Map();

/**
 * Generate a simple admin token
 */
function generateAdminToken() {
	return `admin_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
}

/**
 * Admin authentication middleware
 */
function authenticateAdmin(req, res, next) {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).json({ error: "Admin authentication required" });
	}

	const token = authHeader.substring(7);
	const session = adminSessions.get(token);

	if (!session || session.expiresAt < Date.now()) {
		adminSessions.delete(token);
		return res.status(401).json({ error: "Invalid or expired admin session" });
	}

	// Extend session on activity
	session.expiresAt = Date.now() + 3600000; // 1 hour
	req.adminSession = session;
	next();
}

/**
 * Tables that are protected from dangerous operations
 */
const PROTECTED_TABLES = ["accounts"];

/**
 * Allowed tables for CRUD operations
 */
const ALLOWED_TABLES = [
	"accounts",
	"cart_items",
	"chat_messages",
	"chat_sessions",
	"coffee_products",
	"iot_commands",
	"machine_products",
	"member_status",
	"member_status_history",
	"order_items",
	"orders",
	"repairs",
	"user_cards",
	"user_sessions",
	"user_subscriptions",
	"users",
	"sessions",
];

const CATEGORY_FOLDER_MAP = {
	original: {
		"coffee+": "Coffee+",
		"craft brew": "Craft Brew",
		"creations barista": "Barista Creations",
		"barista creations": "Barista Creations",
		espresso: "Espresso",
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

const normalizeCategoryKey = (value = "") =>
	value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim();

const slugifyFilename = (name = "") =>
	name
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^a-zA-Z0-9._-]/g, "") || `upload-${Date.now()}`;

const resolveImageTarget = (productType, category) => {
	const typeKey = (productType || "").toLowerCase() === "vertuo" ? "vertuo" : "original";
	const categoryKey = normalizeCategoryKey(category);
	const mapped = CATEGORY_FOLDER_MAP[typeKey]?.[categoryKey];
	const categoryDir = mapped || category || "Uncategorized";
	const typeDir = typeKey === "vertuo" ? "Vertuo" : "Original";
	const relativeDir = path.join("images", "Capsules", typeDir, categoryDir);
	// Always target the top-level public/ so Next.js can serve the file
	const projectRoot = path.resolve(__dirname, "..", "..");
	const absoluteDir = path.join(projectRoot, "public", relativeDir);
	return { typeDir, categoryDir, relativeDir, absoluteDir };
};

const upload = multer({
	storage: multer.diskStorage({
		destination: (req, file, cb) => {
			try {
				const { product_type: productType = "", category = "" } = req.body || {};
				console.log("[Upload] Destination - productType:", productType, "category:", category);
				const target = resolveImageTarget(productType, category);
				console.log("[Upload] Destination - absoluteDir:", target.absoluteDir);
				req.uploadTarget = target;
				fs.mkdirSync(target.absoluteDir, { recursive: true });
				cb(null, target.absoluteDir);
			} catch (err) {
				console.error("[Upload] Destination error:", err);
				cb(err);
			}
		},
		filename: (req, file, cb) => {
			const ext = path
				.extname(file.originalname || "")
				.toLowerCase()
				.replace(".", "");
			if (!isAllowedImage(file)) {
				return cb(new Error(`Invalid image type. Allowed: ${Array.from(VALID_IMAGE_EXTENSIONS).join(", ")}`));
			}

			// Preserve the original upload name (without any slugging/timestamp) while still stripping path segments
			const safeName = path.basename(file.originalname);
			cb(null, safeName);
		},
	}),
	fileFilter: (req, file, cb) => {
		if (!isAllowedImage(file)) {
			return cb(new Error("Only png, avif, webp, jpg, or jpeg are allowed"));
		}
		cb(null, true);
	},
	limits: { fileSize: 15 * 1024 * 1024 },
});

/**
 * Admin Login
 */
router.post("/login", async (req, res) => {
	let client;
	try {
		const { username, password } = req.body;

		if (!username || !password) {
			return res.status(400).json({ error: "Username and password are required" });
		}

		client = await pool.connect();
		const result = await client.query("SELECT * FROM users WHERE username = $1", [username]);

		if (result.rows.length === 0) {
			return res.status(401).json({ error: "Invalid credentials" });
		}

		const user = result.rows[0];
		const match = await bcrypt.compare(password, user.password_hash);

		if (!match) {
			return res.status(401).json({ error: "Invalid credentials" });
		}

		if (user.role !== "admin") {
			return res.status(403).json({ error: "Access denied. Admin privileges required." });
		}

		const token = generateAdminToken();
		adminSessions.set(token, {
			username: user.username,
			userId: user.id,
			loginAt: Date.now(),
			expiresAt: Date.now() + 3600000, // 1 hour
		});

		res.json({
			status: "success",
			message: "Admin login successful",
			token,
			expiresIn: 3600,
		});
	} catch (error) {
		console.error("Admin login error:", error);
		res.status(500).json({ error: "Admin login failed" });
	} finally {
		if (client) client.release();
	}
});

/**
 * Admin Logout
 */
router.post("/logout", authenticateAdmin, (req, res) => {
	const authHeader = req.headers.authorization;
	const token = authHeader.substring(7);
	adminSessions.delete(token);
	res.json({ status: "success", message: "Admin logged out" });
});

// Upload coffee capsule image (stored under public/images/Capsules/{Original|Vertuo}/{Category})
router.post("/upload/coffee-image", authenticateAdmin, (req, res) => {
	console.log("[Upload] Request received");
	upload.single("image")(req, res, (err) => {
		if (err) {
			console.error("[Upload] Multer error:", err);
			return res.status(400).json({ error: err.message || "Failed to upload image" });
		}

		if (!req.file) {
			console.error("[Upload] No file in request");
			return res.status(400).json({ error: "No image file provided" });
		}

		const productType = (req.body?.product_type || "").toString().trim();
		const category = (req.body?.category || "").toString().trim();
		if (!productType || !category) {
			// Cleanup the uploaded file if metadata is missing
			if (req.file?.path) fs.unlink(req.file.path, () => {});
			return res.status(400).json({ error: "product_type and category are required before uploading an image" });
		}

		const target = req.uploadTarget || resolveImageTarget(productType, category);
		const extension = path
			.extname(req.file.filename || "")
			.toLowerCase()
			.replace(".", "");
		const relativePath = path.join(target.relativeDir, req.file.filename).replace(/\\/g, "/");

		console.log("[Upload] Success:", {
			filename: req.file.filename,
			absoluteDir: target.absoluteDir,
			relativePath,
			productType,
			category,
			mimetype: req.file.mimetype,
			size: req.file.size,
		});

		return res.json({
			status: "success",
			filename: req.file.filename,
			extension,
			relativePath,
		});
	});
});

/**
 * Get all tables in the database
 */
router.get("/tables", authenticateAdmin, async (req, res) => {
	try {
		const client = await pool.connect();
		try {
			const result = await client.query(
				`SELECT 
					relname as name, 
					reltuples as row_count,
					obj_description(c.oid, 'pg_class') as comment
				 FROM pg_class c
				 JOIN pg_namespace n ON n.oid = c.relnamespace
				 WHERE n.nspname = 'public' AND c.relkind = 'r'
				 ORDER BY relname`
			);

			res.json({
				status: "success",
				tables: result.rows.map((t) => ({
					name: t.name,
					rowCount: Number(t.row_count) || 0,
					comment: t.comment || "",
				})),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get tables error:", error);
		res.status(500).json({ error: "Failed to get tables" });
	}
});

/**
 * Get table schema information (columns)
 */
router.get("/table-info/:table", authenticateAdmin, async (req, res) => {
	try {
		const { table } = req.params;

		// Validate table name
		if (!ALLOWED_TABLES.includes(table)) {
			return res.status(403).json({ error: "Access to this table is not allowed" });
		}

		const client = await pool.connect();
		try {
			const columnsResult = await client.query(
				`SELECT 
					c.column_name as name,
					c.data_type as type,
					c.is_nullable as nullable,
					c.column_default as default_value,
					c.character_maximum_length as max_length,
					pg_catalog.col_description(t.oid, c.ordinal_position) as comment,
					CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END as key_type,
					CASE WHEN c.column_default LIKE 'nextval%' OR c.is_identity = 'YES' THEN true ELSE false END as is_auto_increment
				 FROM information_schema.columns c
				 JOIN pg_class t ON t.relname = c.table_name
				 JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema
				 LEFT JOIN (
					SELECT ku.column_name, ku.table_name, ku.table_schema
					FROM information_schema.table_constraints tc
					JOIN information_schema.key_column_usage ku 
					  ON tc.constraint_name = ku.constraint_name 
					  AND tc.table_schema = ku.table_schema
					WHERE tc.constraint_type = 'PRIMARY KEY'
				 ) pk ON pk.column_name = c.column_name 
				   AND pk.table_name = c.table_name 
				   AND pk.table_schema = c.table_schema
				 WHERE c.table_schema = 'public' AND c.table_name = $1
				 ORDER BY c.ordinal_position`,
				[table]
			);

			// Get primary key
			const pkResult = await client.query(
				`SELECT ku.column_name as name
				 FROM information_schema.table_constraints tc
				 JOIN information_schema.key_column_usage ku 
				   ON tc.constraint_name = ku.constraint_name 
				   AND tc.table_schema = ku.table_schema
				 WHERE tc.constraint_type = 'PRIMARY KEY' 
				   AND tc.table_name = $1 
				   AND tc.table_schema = 'public'`,
				[table]
			);

			const primaryKey = pkResult.rows.length > 0 ? pkResult.rows[0].name : "id";

			res.json({
				status: "success",
				table,
				primaryKey,
				columns: columnsResult.rows.map((c) => ({
					name: c.name,
					type: c.type,
					nullable: c.nullable === "YES",
					isPrimary: c.key_type === "PRI",
					isAutoIncrement: c.is_auto_increment,
					defaultValue: c.default_value,
					maxLength: c.max_length ? Number(c.max_length) : null,
					comment: c.comment || "",
				})),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get table info error:", error);
		res.status(500).json({ error: `Failed to get table info: ${error.message}` });
	}
});

/**
 * Get table data with pagination
 */
router.get("/tables/:table", authenticateAdmin, async (req, res) => {
	try {
		const { table } = req.params;
		const page = parseInt(req.query.page) || 1;
		const limit = Math.min(parseInt(req.query.limit) || 50, 200);
		const offset = (page - 1) * limit;
		const sortBy = req.query.sortBy || "id";
		const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
		const search = req.query.search || "";

		// Validate table name
		if (!ALLOWED_TABLES.includes(table)) {
			return res.status(403).json({ error: "Access to this table is not allowed" });
		}

		const client = await pool.connect();
		try {
			// Get total count
			let countQuery = `SELECT COUNT(*) as total FROM "${table}"`;
			let dataQuery = `SELECT * FROM "${table}"`;
			const params = [];
			let paramIdx = 1;

			// Add search if provided
			if (search) {
				// Get text columns for search
				const columnsResult = await client.query(
					`SELECT column_name FROM information_schema.columns 
					 WHERE table_schema = 'public' AND table_name = $1
					 AND data_type IN ('character varying', 'text', 'character', 'jsonb')`,
					[table]
				);

				if (columnsResult.rows.length > 0) {
					const searchConditions = columnsResult.rows
						.map((c) => `"${c.column_name}"::text ILIKE $${paramIdx++}`)
						.join(" OR ");
					countQuery += ` WHERE (${searchConditions})`;
					dataQuery += ` WHERE (${searchConditions})`;
					columnsResult.rows.forEach(() => params.push(`%${search}%`));
				}
			}

			const countResult = await client.query(countQuery, params);
			const total = Number(countResult.rows[0].total);

			// Add sorting and pagination
			dataQuery += ` ORDER BY "${sortBy}" ${sortOrder} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
			params.push(limit, offset);

			const result = await client.query(dataQuery, params);

			res.json({
				status: "success",
				table,
				data: result.rows,
				pagination: {
					page,
					limit,
					total,
					totalPages: Math.ceil(total / limit),
				},
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get table data error:", error);
		res.status(500).json({ error: "Failed to get table data" });
	}
});

/**
 * Insert new row
 */
router.post("/tables/:table", authenticateAdmin, async (req, res) => {
	try {
		const { table } = req.params;
		const data = req.body;
		// Strip system fields on insert; DB will set defaults
		const sanitized = { ...data };
		delete sanitized.id;
		delete sanitized.created_at;
		delete sanitized.updated_at;

		if (!ALLOWED_TABLES.includes(table)) {
			return res.status(403).json({ error: "Access to this table is not allowed" });
		}

		if (!sanitized || Object.keys(sanitized).length === 0) {
			return res.status(400).json({ error: "No data provided" });
		}

		// Special handling for users table password hashing
		if (table === "users" && sanitized.password_hash) {
			sanitized.password_hash = await bcrypt.hash(sanitized.password_hash, 10);
		}

		const client = await pool.connect();
		try {
			const columns = Object.keys(sanitized);
			const values = Object.values(sanitized);
			const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

			const result = await client.query(
				`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders}) RETURNING id`,
				values
			);

			res.json({
				status: "success",
				message: "Row inserted successfully",
				insertId: Number(result.rows[0].id),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Insert row error:", error);
		res.status(500).json({ error: `Failed to insert row: ${error.message}` });
	}
});

/**
 * Update row
 */
router.put("/tables/:table/:id", authenticateAdmin, async (req, res) => {
	try {
		const { table, id } = req.params;
		const data = req.body;
		// Strip system fields to avoid datetime format issues / PK overwrite
		const sanitized = { ...data };
		delete sanitized.id;
		delete sanitized.created_at;
		delete sanitized.updated_at;

		console.log("[Update] Table:", table, "ID:", id);
		console.log("[Update] Data received:", JSON.stringify(data, null, 2));
		console.log("[Update] Sanitized data:", JSON.stringify(sanitized, null, 2));

		if (!ALLOWED_TABLES.includes(table)) {
			return res.status(403).json({ error: "Access to this table is not allowed" });
		}

		if (!sanitized || Object.keys(sanitized).length === 0) {
			return res.status(400).json({ error: "No data provided" });
		}

		const client = await pool.connect();
		try {
			// Special handling for users table password hashing
			if (table === "users" && sanitized.password_hash) {
				// Get current password hash
				const result = await client.query("SELECT password_hash FROM users WHERE id = $1", [id]);
				const currentUser = result.rows[0];
				if (currentUser && currentUser.password_hash === sanitized.password_hash) {
					// Password hasn't changed (it's the same hash), so don't update it
					delete sanitized.password_hash;
				} else {
					// Password changed, hash it
					sanitized.password_hash = await bcrypt.hash(sanitized.password_hash, 10);
				}
			}

			// Get primary key column name
			const pkResult = await client.query(
				`SELECT ku.column_name as name
				 FROM information_schema.table_constraints tc
				 JOIN information_schema.key_column_usage ku 
				   ON tc.constraint_name = ku.constraint_name 
				   AND tc.table_schema = ku.table_schema
				 WHERE tc.constraint_type = 'PRIMARY KEY' 
				   AND tc.table_name = $1 
				   AND tc.table_schema = 'public'`,
				[table]
			);

			const primaryKey = pkResult.rows.length > 0 ? pkResult.rows[0].name : "id";

			const columns = Object.keys(sanitized);
			const values = Object.values(sanitized);
			const setClause = columns.map((c, i) => `"${c}" = $${i + 1}`).join(", ");

			console.log("[Update] SQL:", `UPDATE "${table}" SET ${setClause} WHERE "${primaryKey}" = $${columns.length + 1}`);
			console.log("[Update] Values:", values);

			const result = await client.query(
				`UPDATE "${table}" SET ${setClause} WHERE "${primaryKey}" = $${columns.length + 1}`,
				[...values, id]
			);

			if (result.rowCount === 0) {
				return res.status(404).json({ error: "Row not found" });
			}

			res.json({
				status: "success",
				message: "Row updated successfully",
				affectedRows: Number(result.rowCount),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Update row error:", error);
		res.status(500).json({ error: `Failed to update row: ${error.message}` });
	}
});

/**
 * Delete row
 */
router.delete("/tables/:table/:id", authenticateAdmin, async (req, res) => {
	try {
		const { table, id } = req.params;

		if (!ALLOWED_TABLES.includes(table)) {
			return res.status(403).json({ error: "Access to this table is not allowed" });
		}

		const client = await pool.connect();
		try {
			// Get primary key column name
			const pkResult = await client.query(
				`SELECT ku.column_name as name
				 FROM information_schema.table_constraints tc
				 JOIN information_schema.key_column_usage ku 
				   ON tc.constraint_name = ku.constraint_name 
				   AND tc.table_schema = ku.table_schema
				 WHERE tc.constraint_type = 'PRIMARY KEY' 
				   AND tc.table_name = $1 
				   AND tc.table_schema = 'public'`,
				[table]
			);

			const primaryKey = pkResult.rows.length > 0 ? pkResult.rows[0].name : "id";

			const result = await client.query(`DELETE FROM "${table}" WHERE "${primaryKey}" = $1`, [id]);

			if (result.rowCount === 0) {
				return res.status(404).json({ error: "Row not found" });
			}

			res.json({
				status: "success",
				message: "Row deleted successfully",
				affectedRows: Number(result.rowCount),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Delete row error:", error);
		res.status(500).json({ error: `Failed to delete row: ${error.message}` });
	}
});

/**
 * Execute raw SQL query (SELECT only for safety)
 */
router.post("/query", authenticateAdmin, async (req, res) => {
	try {
		const { sql } = req.body;

		if (!sql) {
			return res.status(400).json({ error: "SQL query is required" });
		}

		// Only allow SELECT queries for safety
		const trimmedSql = sql.trim().toUpperCase();
		if (!trimmedSql.startsWith("SELECT") && !trimmedSql.startsWith("SHOW") && !trimmedSql.startsWith("DESCRIBE")) {
			return res.status(403).json({
				error: "Only SELECT, SHOW, and DESCRIBE queries are allowed for safety. Use the CRUD endpoints for modifications.",
			});
		}

		const client = await pool.connect();
		try {
			const result = await client.query(sql);
			res.json({
				status: "success",
				data: result.rows,
				rowCount: result.rowCount,
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Query error:", error);
		res.status(500).json({ error: `Query failed: ${error.message}` });
	}
});

module.exports = router;
