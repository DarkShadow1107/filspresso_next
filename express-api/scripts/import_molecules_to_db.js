const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

const repoRoot = path.resolve(__dirname, "..", "..");
const envLocalPath = path.join(repoRoot, ".env.local");
const envPath = path.join(repoRoot, ".env");

if (fs.existsSync(envLocalPath)) {
	dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
	dotenv.config({ path: envPath });
} else {
	dotenv.config();
}

const baseDbConfig = {
	port: parseInt(process.env.DB_PORT || "5432", 10),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD,
};

function buildHostCandidates() {
	const configured = String(process.env.DB_HOST || "localhost").trim();
	if (!configured || configured === "localhost") {
		return ["localhost"];
	}
	return [configured, "localhost"];
}

async function connectWithFallback() {
	const hosts = buildHostCandidates();
	let lastError;

	for (const host of hosts) {
		const pool = new Pool({ ...baseDbConfig, host });
		try {
			const client = await pool.connect();
			await client.query("SELECT 1");
			console.log(`Connected to PostgreSQL host: ${host}`);
			return { pool, client };
		} catch (error) {
			lastError = error;
			await pool.end().catch(() => undefined);
		}
	}

	throw lastError;
}

function normalizeSynonyms(value) {
	if (!value) return [];
	if (Array.isArray(value)) {
		return value.map((v) => String(v).trim()).filter(Boolean);
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? [trimmed] : [];
	}
	return [];
}

async function ensureSchema(client) {
	await client.query(`
		CREATE TABLE IF NOT EXISTS molecules (
			id SERIAL PRIMARY KEY,
			chembl_id VARCHAR(64) UNIQUE,
			name VARCHAR(255),
			smiles TEXT NOT NULL,
			synonyms JSONB DEFAULT '[]'::jsonb,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`);

	await client.query("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS chembl_id VARCHAR(64)");
	await client.query("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS name VARCHAR(255)");
	await client.query("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS smiles TEXT");
	await client.query("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS synonyms JSONB DEFAULT '[]'::jsonb");
	await client.query("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");

	await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_molecules_chembl_id_unique ON molecules(chembl_id)");
	await client.query("CREATE INDEX IF NOT EXISTS idx_molecules_name ON molecules(name)");
}

async function upsertByChembl(client, molecule) {
	await client.query(
		`
		INSERT INTO molecules (chembl_id, name, smiles, synonyms)
		VALUES ($1, $2, $3, $4::jsonb)
		ON CONFLICT (chembl_id) DO UPDATE
		SET name = EXCLUDED.name,
			smiles = EXCLUDED.smiles,
			synonyms = EXCLUDED.synonyms
		`,
		[molecule.chembl_id, molecule.name, molecule.smiles, JSON.stringify(molecule.synonyms)],
	);
}

async function upsertBySmilesFallback(client, molecule) {
	const existing = await client.query("SELECT id FROM molecules WHERE smiles = $1 LIMIT 1", [molecule.smiles]);
	if (existing.rows.length > 0) {
		await client.query(
			"UPDATE molecules SET name = COALESCE($1, name), synonyms = $2::jsonb WHERE id = $3",
			[molecule.name, JSON.stringify(molecule.synonyms), existing.rows[0].id],
		);
		return;
	}

	await client.query(
		"INSERT INTO molecules (chembl_id, name, smiles, synonyms) VALUES ($1, $2, $3, $4::jsonb)",
		[molecule.chembl_id, molecule.name, molecule.smiles, JSON.stringify(molecule.synonyms)],
	);
}

async function run() {
	const dataPath = path.join(repoRoot, "public", "data", "chembl-molecules.json");
	if (!fs.existsSync(dataPath)) {
		throw new Error(`Dataset file not found: ${dataPath}`);
	}

	const raw = fs.readFileSync(dataPath, "utf8");
	const parsed = JSON.parse(raw);
	const source = Array.isArray(parsed) ? parsed : parsed.molecules;

	if (!Array.isArray(source)) {
		throw new Error("Invalid dataset format: expected array or { molecules: [] }");
	}

	if (!process.env.DB_PASSWORD) {
		throw new Error("DB_PASSWORD environment variable is required");
	}

	let client;
	let activePool;
	let imported = 0;
	let skipped = 0;

	try {
		const connection = await connectWithFallback();
		activePool = connection.pool;
		client = connection.client;
		await client.query("BEGIN");
		await ensureSchema(client);

		for (const row of source) {
			const smiles = String(row.smiles || "").trim();
			if (!smiles) {
				skipped += 1;
				continue;
			}

			const molecule = {
				chembl_id: String(row.chembl_id || "").trim() || null,
				name: String(row.name || "").trim() || null,
				smiles,
				synonyms: normalizeSynonyms(row.synonyms),
			};

			if (molecule.chembl_id) {
				await upsertByChembl(client, molecule);
			} else {
				await upsertBySmilesFallback(client, molecule);
			}
			imported += 1;
		}

		await client.query("COMMIT");
		console.log(`Molecule import completed. Imported/updated: ${imported}, skipped: ${skipped}`);
	} catch (error) {
		if (client) {
			await client.query("ROLLBACK");
		}
		throw error;
	} finally {
		if (client) client.release();
		if (activePool) {
			await activePool.end();
		}
	}
}

run().catch((error) => {
	console.error("Molecule import failed:", error.message);
	process.exit(1);
});
