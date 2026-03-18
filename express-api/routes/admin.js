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
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcrypt");
const pool = require("../db/connection");

const router = express.Router();
const ADMIN_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const ADMIN_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const VALID_IMAGE_EXTENSIONS = new Set(["png", "avif", "webp", "jpg", "jpeg", "svg"]);

const ADMIN_LOGIN_WINDOW_MS = Math.max(60_000, Number.parseInt(process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS || "900000", 10));
const ADMIN_LOGIN_MAX_ATTEMPTS = Math.max(3, Number.parseInt(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX || "15", 10));
const ADMIN_QUERY_MAX_LENGTH = Math.max(64, Number.parseInt(process.env.ADMIN_QUERY_MAX_LENGTH || "5000", 10));
const ADMIN_QUERY_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.ADMIN_QUERY_TIMEOUT_MS || "4000", 10));

const adminLoginLimiter = rateLimit({
	windowMs: ADMIN_LOGIN_WINDOW_MS,
	max: ADMIN_LOGIN_MAX_ATTEMPTS,
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
	message: { error: "Too many admin login attempts. Please try again later." },
});

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

/**
 * Generate a simple admin token
 */
function generateAdminToken() {
	return `admin_${crypto.randomBytes(32).toString("hex")}`;
}

function isSafeReadOnlyAdminQuery(sql) {
	const normalized = String(sql || "").trim();
	if (!normalized) return false;
	if (normalized.length > ADMIN_QUERY_MAX_LENGTH) return false;

	// Block stacked queries and SQL comments.
	if (normalized.includes(";") || /--|\/\*/.test(normalized)) {
		return false;
	}

	const upper = normalized.toUpperCase();
	if (!(upper.startsWith("SELECT") || upper.startsWith("WITH") || upper.startsWith("SHOW") || upper.startsWith("DESCRIBE"))) {
		return false;
	}

	// Block mutating/privileged operations even if embedded in CTEs.
	if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|MERGE|CALL|COPY|DO|EXECUTE)\b/.test(upper)) {
		return false;
	}

	return true;
}

function isSafeSqlIdentifier(value) {
	return ADMIN_IDENTIFIER_PATTERN.test(String(value || ""));
}

// Admin authentication middleware
async function authenticateAdmin(req, res, next) {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).json({ error: "Admin authentication required" });
	}

	const token = authHeader.substring(7).trim();
	if (!token) {
		return res.status(401).json({ error: "Invalid or expired admin session" });
	}

	let client;
	try {
		client = await pool.connect();
		const sessionResult = await client.query(
			`SELECT s.account_id, a.username
			 FROM user_sessions s
			 JOIN accounts a ON a.id = s.account_id
			 WHERE s.session_token = $1
			   AND s.expires_at > NOW()
			   AND a.role = 'admin'
			 LIMIT 1`,
			[token],
		);

		const session = sessionResult.rows[0];
		if (!session) {
			return res.status(401).json({ error: "Invalid or expired admin session" });
		}

		const expiresAt = new Date(Date.now() + ADMIN_SESSION_TIMEOUT_MS);
		await client.query("UPDATE user_sessions SET expires_at = $1 WHERE session_token = $2", [expiresAt, token]);

		req.adminSession = {
			username: session.username,
			userId: session.account_id,
			expiresAt: expiresAt.getTime(),
		};
		next();
	} catch (error) {
		console.error("Admin auth error:", error);
		return res.status(500).json({ error: "Admin authentication failed" });
	} finally {
		if (client) client.release();
	}
}

async function getPublicTables(client) {
	const result = await client.query(
		`SELECT relname AS name
		 FROM pg_class c
		 JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public' AND c.relkind = 'r'
		 ORDER BY relname`,
	);

	return result.rows.map((row) => row.name);
}

async function assertPublicTable(client, table) {
	const result = await client.query(
		`SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1
		) AS exists`,
		[table],
	);

	return Boolean(result.rows[0]?.exists);
}

async function getTableColumns(client, table) {
	const result = await client.query(
		`SELECT
			c.column_name AS name,
			c.data_type AS type,
			c.is_nullable AS nullable,
			c.column_default AS default_value,
			c.character_maximum_length AS max_length,
			CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END AS key_type,
			CASE WHEN c.column_default LIKE 'nextval%' OR c.is_identity = 'YES' THEN true ELSE false END AS is_auto_increment
		 FROM information_schema.columns c
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
		[table],
	);

	return result.rows.map((column) => ({
		name: column.name,
		type: column.type,
		nullable: column.nullable === "YES",
		isPrimary: column.key_type === "PRI",
		isAutoIncrement: column.is_auto_increment,
		defaultValue: column.default_value,
		maxLength: column.max_length ? Number(column.max_length) : null,
	}));
}

async function getPrimaryKey(client, table) {
	const result = await client.query(
		`SELECT ku.column_name AS name
		 FROM information_schema.table_constraints tc
		 JOIN information_schema.key_column_usage ku
		   ON tc.constraint_name = ku.constraint_name
		   AND tc.table_schema = ku.table_schema
		 WHERE tc.constraint_type = 'PRIMARY KEY'
		   AND tc.table_name = $1
		   AND tc.table_schema = 'public'
		 ORDER BY ku.ordinal_position`,
		[table],
	);

	return result.rows[0]?.name || "id";
}

function sanitizeRowData(data, columns) {
	const editableColumns = new Map(columns.filter((column) => !column.isAutoIncrement).map((column) => [column.name, column]));

	const sanitized = {};
	for (const [key, value] of Object.entries(data || {})) {
		if (editableColumns.has(key)) {
			sanitized[key] = value;
		}
	}

	delete sanitized.created_at;
	delete sanitized.updated_at;

	return sanitized;
}

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
router.post("/login", adminLoginLimiter, async (req, res) => {
	let client;
	try {
		const username = String(req.body?.username || "")
			.trim()
			.toLowerCase()
			.slice(0, 64);
		const password = typeof req.body?.password === "string" ? req.body.password : "";

		if (!username || !password || password.length > 128) {
			return res.status(400).json({ error: "Username and password are required" });
		}

		client = await pool.connect();
		// Find an admin user record in the database
		const result = await client.query("SELECT * FROM accounts WHERE LOWER(username) = $1 AND role = 'admin'", [username]);

		if (result.rows.length === 0) {
			return res.status(401).json({ error: "Invalid credentials" });
		}

		const user = result.rows[0];

		// Compare password with database hash
		const isValid = await bcrypt.compare(password, user.password_hash);
		if (!isValid) {
			return res.status(401).json({ error: "Invalid credentials" });
		}

		const token = generateAdminToken();
		const expiresAt = new Date(Date.now() + ADMIN_SESSION_TIMEOUT_MS);

		// Record session in database for auditing
		await client.query("INSERT INTO user_sessions (account_id, session_token, expires_at) VALUES ($1, $2, $3)", [
			user.id,
			token,
			expiresAt,
		]);

		res.json({
			status: "success",
			message: "Admin login successful",
			token,
			expiresIn: Math.floor(ADMIN_SESSION_TIMEOUT_MS / 1000),
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
router.post("/logout", authenticateAdmin, async (req, res) => {
	const authHeader = req.headers.authorization;
	const token = authHeader.substring(7);

	let client;
	try {
		client = await pool.connect();
		await client.query("DELETE FROM user_sessions WHERE session_token = $1", [token]);
	} catch (error) {
		console.error("Error deleting admin session from DB:", error);
	} finally {
		if (client) client.release();
	}

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
			// Get table names and comments
			const metaResult = await client.query(
				`SELECT 
					relname as name, 
					obj_description(c.oid, 'pg_class') as comment
				 FROM pg_class c
				 JOIN pg_namespace n ON n.oid = c.relnamespace
				 WHERE n.nspname = 'public' AND c.relkind = 'r'
				 ORDER BY relname`,
			);

			if (metaResult.rows.length === 0) {
				return res.json({ status: "success", tables: [] });
			}

			// Build a single UNION ALL query for accurate row counts
			const countQuery = metaResult.rows
				.map((t) => `SELECT '${t.name}' as name, COUNT(*)::bigint as row_count FROM "${t.name}"`)
				.join(" UNION ALL ");

			const countResult = await client.query(countQuery);
			const countMap = {};
			for (const row of countResult.rows) {
				countMap[row.name] = Number(row.row_count);
			}

			res.json({
				status: "success",
				tables: metaResult.rows.map((t) => ({
					name: t.name,
					rowCount: countMap[t.name] ?? 0,
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
		if (!isSafeSqlIdentifier(table)) {
			return res.status(400).json({ error: "Invalid table name" });
		}

		const client = await pool.connect();
		try {
			const tableExists = await assertPublicTable(client, table);
			if (!tableExists) {
				return res.status(404).json({ error: "Table not found" });
			}

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
				[table],
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
				[table],
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
		if (!isSafeSqlIdentifier(table)) {
			return res.status(400).json({ error: "Invalid table name" });
		}
		const page = parseInt(req.query.page) || 1;
		const limit = Math.min(parseInt(req.query.limit) || 50, 200);
		const offset = (page - 1) * limit;
		const requestedSortBy = req.query.sortBy || "id";
		if (!isSafeSqlIdentifier(requestedSortBy)) {
			return res.status(400).json({ error: "Invalid sort column" });
		}
		const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
		const search = req.query.search || "";

		const client = await pool.connect();
		try {
			const tableExists = await assertPublicTable(client, table);
			if (!tableExists) {
				return res.status(404).json({ error: "Table not found" });
			}

			const tableColumns = await getTableColumns(client, table);
			const columnNames = new Set(tableColumns.map((column) => column.name));
			const sortBy = columnNames.has(requestedSortBy) ? requestedSortBy : await getPrimaryKey(client, table);

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
					[table],
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
		if (!isSafeSqlIdentifier(table)) {
			return res.status(400).json({ error: "Invalid table name" });
		}
		const data = req.body;

		const client = await pool.connect();
		try {
			const tableExists = await assertPublicTable(client, table);
			if (!tableExists) {
				return res.status(404).json({ error: "Table not found" });
			}

			const tableColumns = await getTableColumns(client, table);
			const sanitized = sanitizeRowData(data, tableColumns);

			if (!sanitized || Object.keys(sanitized).length === 0) {
				return res.status(400).json({ error: "No editable data provided" });
			}

			if (table === "accounts" && sanitized.password_hash) {
				sanitized.password_hash = await bcrypt.hash(sanitized.password_hash, 10);
			}

			const primaryKey = await getPrimaryKey(client, table);
			const columns = Object.keys(sanitized);
			const values = Object.values(sanitized);
			const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

			const result = await client.query(
				`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders}) RETURNING "${primaryKey}"`,
				values,
			);

			res.json({
				status: "success",
				message: "Row inserted successfully",
				insertId: result.rows[0]?.[primaryKey] ?? null,
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
		if (!isSafeSqlIdentifier(table)) {
			return res.status(400).json({ error: "Invalid table name" });
		}
		const data = req.body;

		const client = await pool.connect();
		try {
			const tableExists = await assertPublicTable(client, table);
			if (!tableExists) {
				return res.status(404).json({ error: "Table not found" });
			}

			const tableColumns = await getTableColumns(client, table);
			const sanitized = sanitizeRowData(data, tableColumns);

			if (!sanitized || Object.keys(sanitized).length === 0) {
				return res.status(400).json({ error: "No editable data provided" });
			}

			// Special handling for accounts table password hashing
			if (table === "accounts" && sanitized.password_hash) {
				// Get current password hash
				const result = await client.query("SELECT password_hash FROM accounts WHERE id = $1", [id]);
				const currentUser = result.rows[0];
				if (currentUser && currentUser.password_hash === sanitized.password_hash) {
					// Password hasn't changed (it's the same hash), so don't update it
					delete sanitized.password_hash;
				} else {
					// Password changed, hash it
					sanitized.password_hash = await bcrypt.hash(sanitized.password_hash, 10);
				}
			}

			const primaryKey = await getPrimaryKey(client, table);

			const columns = Object.keys(sanitized);
			const values = Object.values(sanitized);
			const setClause = columns.map((c, i) => `"${c}" = $${i + 1}`).join(", ");

			const result = await client.query(
				`UPDATE "${table}" SET ${setClause} WHERE "${primaryKey}" = $${columns.length + 1}`,
				[...values, id],
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
		if (!isSafeSqlIdentifier(table)) {
			return res.status(400).json({ error: "Invalid table name" });
		}

		const client = await pool.connect();
		try {
			const tableExists = await assertPublicTable(client, table);
			if (!tableExists) {
				return res.status(404).json({ error: "Table not found" });
			}

			const primaryKey = await getPrimaryKey(client, table);

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

		if (!isSafeReadOnlyAdminQuery(sql)) {
			return res.status(403).json({
				error: "Only single-statement read-only queries are allowed (SELECT/WITH/SHOW/DESCRIBE).",
			});
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(`SET LOCAL statement_timeout = ${ADMIN_QUERY_TIMEOUT_MS}`);
			await client.query("SET TRANSACTION READ ONLY");
			const result = await client.query(sql);
			await client.query("ROLLBACK");
			res.json({
				status: "success",
				data: result.rows,
				rowCount: result.rowCount,
			});
		} catch (queryError) {
			await client.query("ROLLBACK");
			throw queryError;
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Query error:", error);
		res.status(500).json({ error: `Query failed: ${error.message}` });
	}
});

/**
 * Security telemetry summary for auth/lockout monitoring
 */
router.get("/security/telemetry", authenticateAdmin, async (req, res) => {
	const rawWindowHours = Number.parseInt(String(req.query.windowHours || "24"), 10);
	const windowHours = Number.isFinite(rawWindowHours) ? Math.min(Math.max(rawWindowHours, 1), 24 * 30) : 24;

	let client;
	try {
		client = await pool.connect();
		const summaryResult = await client.query(
			`SELECT
				COUNT(*) FILTER (WHERE event_type = 'login_failed') AS failed_logins,
				COUNT(*) FILTER (WHERE event_type = 'login_locked') AS lock_events,
				COUNT(*) FILTER (WHERE event_type = 'login_success') AS successful_logins,
				COUNT(DISTINCT ip_address) FILTER (WHERE event_type IN ('login_failed', 'login_locked')) AS distinct_source_ips
			 FROM auth_security_events
			 WHERE created_at >= NOW() - (($1)::text || ' hours')::interval`,
			[windowHours],
		);

		const lockedAccountsResult = await client.query(
			`SELECT login_key, failed_attempts, lock_until, last_failed_at
			 FROM auth_login_attempts
			 WHERE lock_until IS NOT NULL
			   AND lock_until > NOW()
			 ORDER BY lock_until DESC
			 LIMIT 200`,
		);

		const topSourcesResult = await client.query(
			`SELECT ip_address, COUNT(*)::int AS attempts
			 FROM auth_security_events
			 WHERE created_at >= NOW() - (($1)::text || ' hours')::interval
			   AND event_type IN ('login_failed', 'login_locked')
			   AND ip_address IS NOT NULL
			 GROUP BY ip_address
			 ORDER BY attempts DESC
			 LIMIT 20`,
			[windowHours],
		);

		const summary = summaryResult.rows[0] || {};
		res.json({
			status: "success",
			windowHours,
			summary: {
				failedLogins: Number(summary.failed_logins || 0),
				lockEvents: Number(summary.lock_events || 0),
				successfulLogins: Number(summary.successful_logins || 0),
				distinctSourceIps: Number(summary.distinct_source_ips || 0),
			},
			lockedLoginKeys: lockedAccountsResult.rows,
			topSources: topSourcesResult.rows,
		});
	} catch (error) {
		console.error("Security telemetry error:", error);
		res.status(500).json({ error: "Failed to fetch security telemetry" });
	} finally {
		if (client) client.release();
	}
});

/**
 * Recent auth security events for investigation and incident response
 */
router.get("/security/events", authenticateAdmin, async (req, res) => {
	const rawLimit = Number.parseInt(String(req.query.limit || "200"), 10);
	const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 200;

	let client;
	try {
		client = await pool.connect();
		const eventsResult = await client.query(
			`SELECT id, event_type, login_key, account_id, ip_address, user_agent, details, created_at
			 FROM auth_security_events
			 ORDER BY created_at DESC
			 LIMIT $1`,
			[limit],
		);

		res.json({
			status: "success",
			count: eventsResult.rows.length,
			events: eventsResult.rows,
		});
	} catch (error) {
		console.error("Security events error:", error);
		res.status(500).json({ error: "Failed to fetch security events" });
	} finally {
		if (client) client.release();
	}
});

/**
 * Clear lockout state for a specific login identifier (admin incident response)
 */
router.delete("/security/lockouts/:loginKey", authenticateAdmin, async (req, res) => {
	const loginKey = String(req.params.loginKey || "")
		.trim()
		.toLowerCase()
		.slice(0, 254);
	if (!loginKey) {
		return res.status(400).json({ error: "loginKey is required" });
	}

	let client;
	try {
		client = await pool.connect();
		const result = await client.query("DELETE FROM auth_login_attempts WHERE login_key = $1", [loginKey]);
		await client.query(
			`INSERT INTO auth_security_events (event_type, login_key, account_id, ip_address, user_agent, details)
			 VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
			[
				"lockout_cleared_admin",
				loginKey,
				req.adminSession?.userId || null,
				null,
				null,
				JSON.stringify({ clearedBy: req.adminSession?.username || "unknown" }),
			],
		);
		res.json({ status: "success", removed: Number(result.rowCount || 0) });
	} catch (error) {
		console.error("Lockout clear error:", error);
		res.status(500).json({ error: "Failed to clear lockout" });
	} finally {
		if (client) client.release();
	}
});

module.exports = router;
