/**
 * Products Routes
 * GET /api/products/coffee - Get all coffee products with stock
 * GET /api/products/coffee/:id - Get single coffee product
 * GET /api/products/machines - Get all machine products with stock
 * GET /api/products/machines/:id - Get single machine product
 * PUT /api/products/coffee/:id/stock - Update coffee stock (admin)
 * PUT /api/products/machines/:id/stock - Update machine stock (admin)
 */

const express = require("express");
const pool = require("../db/connection");

const router = express.Router();

/**
 * Get all coffee products with stock info
 */
router.get("/coffee", async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			const products = await conn.query(
				`SELECT product_id, name, price, stock, 
				        CASE 
				            WHEN stock >= 10 THEN 'in_stock'
				            WHEN stock > 0 THEN 'low_stock'
				            ELSE 'out_of_stock'
				        END as stock_status
				 FROM coffee_products
				 ORDER BY name`
			);

			res.json({
				status: "success",
				products: products.map((p) => ({
					productId: p.product_id,
					name: p.name,
					price: Number(p.price),
					stock: p.stock,
					stockStatus: p.stock_status,
				})),
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get coffee products error:", error);
		res.status(500).json({ error: "Failed to get coffee products" });
	}
});

/**
 * Get single coffee product by product_id
 */
router.get("/coffee/:productId", async (req, res) => {
	try {
		const { productId } = req.params;
		const conn = await pool.getConnection();
		try {
			const [product] = await conn.query(
				`SELECT product_id, name, price, stock,
				        CASE 
				            WHEN stock >= 10 THEN 'in_stock'
				            WHEN stock > 0 THEN 'low_stock'
				            ELSE 'out_of_stock'
				        END as stock_status
				 FROM coffee_products
				 WHERE product_id = ?`,
				[productId]
			);

			if (!product) {
				return res.status(404).json({ error: "Coffee product not found" });
			}

			res.json({
				status: "success",
				product: {
					productId: product.product_id,
					name: product.name,
					price: Number(product.price),
					stock: product.stock,
					stockStatus: product.stock_status,
				},
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get coffee product error:", error);
		res.status(500).json({ error: "Failed to get coffee product" });
	}
});

/**
 * Get all machine products with stock info
 */
router.get("/machines", async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			const products = await conn.query(
				`SELECT product_id, name, price, stock,
				        CASE 
				            WHEN stock >= 4 THEN 'in_stock'
				            WHEN stock > 0 THEN 'low_stock'
				            ELSE 'out_of_stock'
				        END as stock_status
				 FROM machine_products
				 ORDER BY name`
			);

			res.json({
				status: "success",
				products: products.map((p) => ({
					productId: p.product_id,
					name: p.name,
					price: Number(p.price),
					stock: p.stock,
					stockStatus: p.stock_status,
				})),
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get machine products error:", error);
		res.status(500).json({ error: "Failed to get machine products" });
	}
});

/**
 * Get single machine product by product_id
 */
router.get("/machines/:productId", async (req, res) => {
	try {
		const { productId } = req.params;
		const conn = await pool.getConnection();
		try {
			const [product] = await conn.query(
				`SELECT product_id, name, price, stock,
				        CASE 
				            WHEN stock >= 4 THEN 'in_stock'
				            WHEN stock > 0 THEN 'low_stock'
				            ELSE 'out_of_stock'
				        END as stock_status
				 FROM machine_products
				 WHERE product_id = ?`,
				[productId]
			);

			if (!product) {
				return res.status(404).json({ error: "Machine product not found" });
			}

			res.json({
				status: "success",
				product: {
					productId: product.product_id,
					name: product.name,
					price: Number(product.price),
					stock: product.stock,
					stockStatus: product.stock_status,
				},
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get machine product error:", error);
		res.status(500).json({ error: "Failed to get machine product" });
	}
});

/**
 * Decrease stock when ordering (internal use)
 */
router.post("/decrease-stock", async (req, res) => {
	try {
		const { items } = req.body;

		if (!items || !Array.isArray(items)) {
			return res.status(400).json({ error: "Items array is required" });
		}

		const conn = await pool.getConnection();
		try {
			await conn.beginTransaction();

			for (const item of items) {
				const { productId, quantity, type } = item;
				const table = type === "machine" ? "machine_products" : "coffee_products";

				// Check current stock
				const [product] = await conn.query(`SELECT stock FROM \`${table}\` WHERE product_id = ?`, [productId]);

				if (!product) {
					await conn.rollback();
					return res.status(404).json({ error: `Product ${productId} not found` });
				}

				if (product.stock < quantity) {
					await conn.rollback();
					return res.status(400).json({
						error: `Insufficient stock for ${productId}. Available: ${product.stock}, Requested: ${quantity}`,
					});
				}

				// Decrease stock
				await conn.query(`UPDATE \`${table}\` SET stock = stock - ? WHERE product_id = ?`, [quantity, productId]);
			}

			await conn.commit();
			res.json({ status: "success", message: "Stock updated successfully" });
		} catch (error) {
			await conn.rollback();
			throw error;
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Decrease stock error:", error);
		res.status(500).json({ error: "Failed to decrease stock" });
	}
});

/**
 * Sync products from JSON files (creates entries for products not in DB)
 */
router.post("/sync", async (req, res) => {
	try {
		const { coffeeProducts, machineProducts } = req.body;

		const conn = await pool.getConnection();
		try {
			let coffeeInserted = 0;
			let machineInserted = 0;

			// Sync coffee products
			if (coffeeProducts && Array.isArray(coffeeProducts)) {
				for (const product of coffeeProducts) {
					const result = await conn.query(
						`INSERT IGNORE INTO coffee_products (product_id, name, price, stock) VALUES (?, ?, ?, 100)`,
						[product.id, product.name, product.priceRon || 0]
					);
					if (result.affectedRows > 0) coffeeInserted++;
				}
			}

			// Sync machine products
			if (machineProducts && Array.isArray(machineProducts)) {
				for (const product of machineProducts) {
					const result = await conn.query(
						`INSERT IGNORE INTO machine_products (product_id, name, price, stock) VALUES (?, ?, ?, 10)`,
						[product.id, product.name, product.priceRon || 0]
					);
					if (result.affectedRows > 0) machineInserted++;
				}
			}

			res.json({
				status: "success",
				message: "Products synced successfully",
				coffeeInserted,
				machineInserted,
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Sync products error:", error);
		res.status(500).json({ error: "Failed to sync products" });
	}
});

module.exports = router;
