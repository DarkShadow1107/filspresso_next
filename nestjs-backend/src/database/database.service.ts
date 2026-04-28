import { Injectable, Logger } from "@nestjs/common";
import { Pool } from "pg";
import { getEnvOrFile } from "../common/utils/secrets";

@Injectable()
export class DatabaseService {
	private readonly logger = new Logger(DatabaseService.name);
	private readonly pool: Pool;

	constructor() {
		const STRICT_SERVICE_DB_CREDENTIALS =
			String(process.env.STRICT_SERVICE_DB_CREDENTIALS || "false")
				.trim()
				.toLowerCase() === "true";
		const BACKEND_DB_USER = String(process.env.BACKEND_DB_USER || "").trim();
		const ROOT_DB_USER = String(process.env.DB_USER || "filspresso_user").trim();
		const DB_USER = BACKEND_DB_USER || ROOT_DB_USER;

		const BACKEND_DB_PASSWORD = getEnvOrFile("BACKEND_DB_PASSWORD", { required: false, defaultValue: "" });
		const ROOT_DB_PASSWORD = getEnvOrFile("DB_PASSWORD", { required: true });
		const DB_PASSWORD = BACKEND_DB_PASSWORD || ROOT_DB_PASSWORD;

		if (STRICT_SERVICE_DB_CREDENTIALS) {
			if (!BACKEND_DB_USER) throw new Error("STRICT_SERVICE_DB_CREDENTIALS=true requires BACKEND_DB_USER");
			if (BACKEND_DB_USER === ROOT_DB_USER)
				throw new Error("STRICT_SERVICE_DB_CREDENTIALS=true requires BACKEND_DB_USER to differ from DB_USER");
			if (!BACKEND_DB_PASSWORD)
				throw new Error("STRICT_SERVICE_DB_CREDENTIALS=true requires BACKEND_DB_PASSWORD or BACKEND_DB_PASSWORD_FILE");
		}

		this.pool = new Pool({
			host: process.env.DB_HOST || "localhost",
			port: Number.parseInt(process.env.DB_PORT || "5432", 10),
			database: process.env.DB_NAME || "filspresso",
			user: DB_USER,
			password: DB_PASSWORD,
			max: 20,
			min: 2,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 3000,
			statement_timeout: 30000,
			query_timeout: 30000,
			application_name: "filspresso-nestjs-backend",
		});

		this.pool
			.query("SELECT NOW()")
			.then(() => this.logger.log("✅ Connected to PostgreSQL database"))
			.catch((err) => this.logger.error("❌ Failed to connect to PostgreSQL:", err.message));
	}

	getPool(): Pool {
		return this.pool;
	}

	async checkHealth(): Promise<{ isUp: boolean; error: string | null }> {
		let client;
		try {
			client = await this.pool.connect();
			await client.query("SELECT 1");
			return { isUp: true, error: null };
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return { isUp: false, error: detail || "Database health check failed" };
		} finally {
			if (client) {
				client.release();
			}
		}
	}
}
