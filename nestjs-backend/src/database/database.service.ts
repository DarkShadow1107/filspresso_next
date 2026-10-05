import { Injectable, Logger } from "@nestjs/common";
import { Pool } from "pg";
import { getEnvOrFile } from "../common/utils/secrets";

/**
 * Reads a pool tuning knob from the environment.
 *
 * Falls back to `fallback` on a missing, non-numeric or out-of-range value rather
 * than handing NaN to `pg`, which would otherwise silently produce a pool that
 * cannot connect.
 */
function parsePoolInt(name: string, fallback: number, min: number): number {
	const raw = String(process.env[name] ?? "").trim();
	if (raw === "") return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < min) {
		return fallback;
	}
	return parsed;
}

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
			// Pool sizing is configuration, not a constant. The default stays at the
			// historical 20 so behaviour is unchanged until it is tuned deliberately:
			// Postgres allows max_connections=100 by default, so the replica count
			// times DB_POOL_MAX must stay under that or replicas will start failing
			// to connect rather than merely queueing.
			max: parsePoolInt("DB_POOL_MAX", 20, 1),
			min: parsePoolInt("DB_POOL_MIN", 2, 0),
			idleTimeoutMillis: parsePoolInt("DB_POOL_IDLE_TIMEOUT_MS", 30_000, 0),
			connectionTimeoutMillis: 3000,
			statement_timeout: 30000,
			query_timeout: 30000,
			application_name: "filspresso-nestjs-backend",
		});

		// node-postgres emits 'error' on the pool when an *idle* client fails --
		// a Postgres restart, a network blip, an admin terminating the connection.
		// Without a listener Node treats that as an unhandled 'error' event and
		// rethrows, killing the entire process ("throw er; // Unhandled 'error'
		// event"), which is what crash-looped this service. The pool already
		// discards the bad client and opens a fresh one on the next query, so the
		// correct response is to log and keep serving, not to exit.
		this.pool.on("error", (err: Error) => {
			this.logger.error(`Unexpected idle PostgreSQL client error: ${err.message}`);
		});

		this.pool
			.query("SELECT NOW()")
			.then(() => this.logger.log("✅ Connected to PostgreSQL database"))
			.catch((err) => this.logger.error("❌ Failed to connect to PostgreSQL:", err.message));
	}

	getPool(): Pool {
		return this.pool;
	}

	/**
	 * Current pool occupancy, for the saturation assertions in the load test.
	 *
	 * `waiting` is the number that matters: it counts callers queued for a connection,
	 * so a non-zero value is proof that the pool is a bottleneck rather than a guess
	 * from latency alone. `idleCount`/`totalCount` are `pg` counters and are already
	 * capped at `max`, so they cannot overflow.
	 */
	getPoolStats(): { total: number; idle: number; waiting: number; max: number } {
		return {
			total: this.pool.totalCount,
			idle: this.pool.idleCount,
			waiting: this.pool.waitingCount,
			max: this.pool.options.max ?? 0,
		};
	}

	/**
	 * Closes every pooled connection.
	 *
	 * Called during graceful shutdown. `pool.end()` drains in-flight queries and
	 * resolves when the last client is released; without it the process exits with
	 * sockets still open, which is what produces "server closed the connection
	 * unexpectedly" for a checkout that was mid-write when SIGTERM arrived.
	 */
	async endPool(): Promise<void> {
		try {
			await this.pool.end();
			this.logger.log("PostgreSQL pool closed cleanly");
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.logger.error(`Failed to close the PostgreSQL pool cleanly: ${detail}`);
		}
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
