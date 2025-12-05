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
const pool = require("../db/connection");

const router = express.Router();

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
];

/**
 * Admin Login
 */
router.post("/login", async (req, res) => {
	try {
		const { username, password } = req.body;

		if (!username || !password) {
			return res.status(400).json({ error: "Username and password are required" });
		}

		if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
			return res.status(401).json({ error: "Invalid admin credentials" });
		}

		const token = generateAdminToken();
		adminSessions.set(token, {
			username: ADMIN_USERNAME,
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

/**
 * Get all tables in the database
 */
router.get("/tables", authenticateAdmin, async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			const tables = await conn.query(
				`SELECT TABLE_NAME as name, TABLE_ROWS as rowCount, TABLE_COMMENT as comment
				 FROM information_schema.tables 
				 WHERE table_schema = DATABASE()
				 ORDER BY TABLE_NAME`
			);

			res.json({
				status: "success",
				tables: tables.map((t) => ({
					name: t.name,
					rowCount: Number(t.rowCount) || 0,
					comment: t.comment || "",
				})),
			});
		} finally {
			conn.release();
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

		const conn = await pool.getConnection();
		try {
			const columns = await conn.query(
				`SELECT 
					COLUMN_NAME as name,
					DATA_TYPE as type,
					IS_NULLABLE as nullable,
					COLUMN_KEY as keyType,
					COLUMN_DEFAULT as defaultValue,
					EXTRA as extra,
					CAST(CHARACTER_MAXIMUM_LENGTH AS SIGNED) as maxLength,
					COLUMN_COMMENT as comment
				 FROM information_schema.columns 
				 WHERE table_schema = DATABASE() AND table_name = ?
				 ORDER BY ORDINAL_POSITION`,
				[table]
			);

			// Get primary key
			const pkResult = await conn.query(
				`SELECT COLUMN_NAME as name
				 FROM information_schema.key_column_usage
				 WHERE table_schema = DATABASE() 
				   AND table_name = ? 
				   AND CONSTRAINT_NAME = 'PRIMARY'`,
				[table]
			);

			const primaryKey = pkResult.length > 0 ? pkResult[0].name : "id";

			res.json({
				status: "success",
				table,
				primaryKey,
				columns: columns.map((c) => ({
					name: c.name,
					type: c.type,
					nullable: c.nullable === "YES",
					isPrimary: c.keyType === "PRI",
					isAutoIncrement: c.extra?.includes("auto_increment") || false,
					defaultValue: c.defaultValue,
					maxLength: c.maxLength ? Number(c.maxLength) : null,
					comment: c.comment || "",
				})),
			});
		} finally {
			conn.release();
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

		const conn = await pool.getConnection();
		try {
			// Get total count
			let countQuery = `SELECT COUNT(*) as total FROM \`${table}\``;
			let dataQuery = `SELECT * FROM \`${table}\``;
			const params = [];

			// Add search if provided
			if (search) {
				// Get text columns for search
				const columns = await conn.query(
					`SELECT COLUMN_NAME FROM information_schema.columns 
					 WHERE table_schema = DATABASE() AND table_name = ?
					 AND DATA_TYPE IN ('varchar', 'text', 'char', 'longtext', 'mediumtext')`,
					[table]
				);

				if (columns.length > 0) {
					const searchConditions = columns.map((c) => `\`${c.COLUMN_NAME}\` LIKE ?`).join(" OR ");
					countQuery += ` WHERE (${searchConditions})`;
					dataQuery += ` WHERE (${searchConditions})`;
					columns.forEach(() => params.push(`%${search}%`));
				}
			}

			const [countResult] = await conn.query(countQuery, params);
			const total = Number(countResult.total);

			// Add sorting and pagination
			dataQuery += ` ORDER BY \`${sortBy}\` ${sortOrder} LIMIT ? OFFSET ?`;
			params.push(limit, offset);

			const rows = await conn.query(dataQuery, params);

			res.json({
				status: "success",
				table,
				data: rows,
				pagination: {
					page,
					limit,
					total,
					totalPages: Math.ceil(total / limit),
				},
			});
		} finally {
			conn.release();
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

		if (!ALLOWED_TABLES.includes(table)) {
			return res.status(403).json({ error: "Access to this table is not allowed" });
		}

		if (!data || Object.keys(data).length === 0) {
			return res.status(400).json({ error: "No data provided" });
		}

		const conn = await pool.getConnection();
		try {
			const columns = Object.keys(data);
			const values = Object.values(data);
			const placeholders = columns.map(() => "?").join(", ");

			const result = await conn.query(
				`INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES (${placeholders})`,
				values
			);

			res.json({
				status: "success",
				message: "Row inserted successfully",
				insertId: Number(result.insertId),
			});
		} finally {
			conn.release();
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

		if (!ALLOWED_TABLES.includes(table)) {
			return res.status(403).json({ error: "Access to this table is not allowed" });
		}

		if (!data || Object.keys(data).length === 0) {
			return res.status(400).json({ error: "No data provided" });
		}

		const conn = await pool.getConnection();
		try {
			// Get primary key column name
			const pkResult = await conn.query(
				`SELECT COLUMN_NAME as name
				 FROM information_schema.key_column_usage
				 WHERE table_schema = DATABASE() 
				   AND table_name = ? 
				   AND CONSTRAINT_NAME = 'PRIMARY'`,
				[table]
			);

			const primaryKey = pkResult.length > 0 ? pkResult[0].name : "id";

			const columns = Object.keys(data);
			const values = Object.values(data);
			const setClause = columns.map((c) => `\`${c}\` = ?`).join(", ");

			const result = await conn.query(`UPDATE \`${table}\` SET ${setClause} WHERE \`${primaryKey}\` = ?`, [...values, id]);

			if (result.affectedRows === 0) {
				return res.status(404).json({ error: "Row not found" });
			}

			res.json({
				status: "success",
				message: "Row updated successfully",
				affectedRows: Number(result.affectedRows),
			});
		} finally {
			conn.release();
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

		const conn = await pool.getConnection();
		try {
			// Get primary key column name
			const pkResult = await conn.query(
				`SELECT COLUMN_NAME as name
				 FROM information_schema.key_column_usage
				 WHERE table_schema = DATABASE() 
				   AND table_name = ? 
				   AND CONSTRAINT_NAME = 'PRIMARY'`,
				[table]
			);

			const primaryKey = pkResult.length > 0 ? pkResult[0].name : "id";

			const result = await conn.query(`DELETE FROM \`${table}\` WHERE \`${primaryKey}\` = ?`, [id]);

			if (result.affectedRows === 0) {
				return res.status(404).json({ error: "Row not found" });
			}

			res.json({
				status: "success",
				message: "Row deleted successfully",
				affectedRows: Number(result.affectedRows),
			});
		} finally {
			conn.release();
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

		const conn = await pool.getConnection();
		try {
			const result = await conn.query(sql);
			res.json({
				status: "success",
				data: result,
				rowCount: result.length,
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Query error:", error);
		res.status(500).json({ error: `Query failed: ${error.message}` });
	}
});

module.exports = router;
