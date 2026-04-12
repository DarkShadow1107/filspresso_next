#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const SECRET_MAP = [
	{ env: "DB_PASSWORD", file: "db_password.txt" },
	{ env: "BACKEND_DB_PASSWORD", file: "backend_db_password.txt" },
	{ env: "AI_DB_PASSWORD", file: "ai_db_password.txt" },
	{ env: "JWT_SECRET", file: "jwt_secret.txt" },
	{ env: "JWT_SIGNING_PRIVATE_KEY", file: "jwt_signing_private_key.pem" },
	{ env: "JWT_SIGNING_PUBLIC_KEY", file: "jwt_signing_public_key.pem" },
	{ env: "ENCRYPTION_KEY", file: "encryption_key.txt" },
	{ env: "SERVICE_EVENTS_API_KEY", file: "service_events_api_key.txt" },
	{ env: "SERVICE_ASSERTION_PUBLIC_KEY", file: "service_assertion_public_key.pem" },
	{ env: "SERVICE_ASSERTION_PRIVATE_KEY", file: "service_assertion_private_key.pem" },
	{ env: "GO_OPS_API_KEY", file: "go_ops_api_key.txt" },
	{ env: "REDIS_PASSWORD", file: "redis_password.txt" },
	{ env: "GO_OPS_CLIENT_CERT", file: "go_ops_client_cert.pem" },
	{ env: "GO_OPS_CLIENT_KEY", file: "go_ops_client_key.pem" },
	{ env: "GO_OPS_SERVER_CERT", file: "go_ops_server_cert.pem" },
	{ env: "GO_OPS_SERVER_KEY", file: "go_ops_server_key.pem" },
	{ env: "GO_OPS_CA_CERT", file: "filspresso_ca_cert.pem" },
	{ env: "LEDGER_ANCHOR_PRIVATE_KEY", file: "ledger_anchor_private_key.pem" },
	{ env: "VAULT_KEK", file: "vault_kek.txt" },
];

function parseArgs(argv) {
	const args = {
		envFile: ".env",
		outDir: "secrets",
		force: false,
		dryRun: false,
		strict: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--force") {
			args.force = true;
			continue;
		}
		if (token === "--dry-run") {
			args.dryRun = true;
			continue;
		}
		if (token === "--strict") {
			args.strict = true;
			continue;
		}
		if (token === "--env-file" && argv[i + 1]) {
			args.envFile = argv[i + 1];
			i += 1;
			continue;
		}
		if (token === "--out-dir" && argv[i + 1]) {
			args.outDir = argv[i + 1];
			i += 1;
			continue;
		}
	}

	return args;
}

function decodeQuoted(value, quote) {
	const unwrapped = value.slice(1, -1);
	if (quote === "'") {
		return unwrapped;
	}

	return unwrapped
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");
}

function stripInlineComment(raw) {
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < raw.length; i += 1) {
		const char = raw[i];
		if (char === "'" && !inDouble) {
			inSingle = !inSingle;
			continue;
		}
		if (char === '"' && !inSingle) {
			inDouble = !inDouble;
			continue;
		}
		if (char === "#" && !inSingle && !inDouble) {
			const prev = i > 0 ? raw[i - 1] : "";
			if (prev === " " || prev === "\t" || prev === "") {
				return raw.slice(0, i);
			}
		}
	}

	return raw;
}

function parseDotenv(content) {
	const env = {};
	const lines = content.split(/\r?\n/);

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (!match) continue;

		const key = match[1];
		let value = match[2] ?? "";
		value = stripInlineComment(value).trim();

		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = decodeQuoted(value, value[0]);
		}

		env[key] = value;
	}

	return env;
}

function readEnvFile(filePath) {
	const absolute = path.resolve(process.cwd(), filePath);
	if (!fs.existsSync(absolute)) {
		throw new Error(`Environment file not found: ${absolute}`);
	}

	const content = fs.readFileSync(absolute, "utf8");
	return { absolute, values: parseDotenv(content) };
}

function resolveSecretValue(envValues, entry) {
	const directValue = String(envValues[entry.env] || "").trim();
	if (directValue) {
		return directValue;
	}

	const fileVar = `${entry.env}_FILE`;
	const filePath = String(envValues[fileVar] || "").trim();
	if (!filePath) {
		return "";
	}

	const absoluteFilePath = path.resolve(process.cwd(), filePath);
	if (!fs.existsSync(absoluteFilePath)) {
		return "";
	}

	return String(fs.readFileSync(absoluteFilePath, "utf8") || "").trim();
}

function writeSecretFile(filePath, value, options) {
	const normalized = `${value}\n`;
	if (fs.existsSync(filePath)) {
		const current = fs.readFileSync(filePath, "utf8");
		if (current === normalized) {
			return "unchanged";
		}
		if (!options.force) {
			return "skipped";
		}
	}

	if (!options.dryRun) {
		fs.writeFileSync(filePath, normalized, { encoding: "utf8", mode: 0o600 });
	}
	return "written";
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const { absolute: envFilePath, values: envValues } = readEnvFile(args.envFile);
	const outDir = path.resolve(process.cwd(), args.outDir);

	if (!args.dryRun) {
		fs.mkdirSync(outDir, { recursive: true });
	}

	const summary = {
		written: 0,
		unchanged: 0,
		skipped: 0,
		missing: 0,
	};

	console.log(`Using env file: ${envFilePath}`);
	console.log(`Secrets output directory: ${outDir}`);
	console.log(`Mode: ${args.dryRun ? "dry-run" : "write"}${args.force ? " (force overwrite enabled)" : ""}`);

	for (const entry of SECRET_MAP) {
		const value = resolveSecretValue(envValues, entry);
		const targetPath = path.join(outDir, entry.file);

		if (!value) {
			summary.missing += 1;
			console.warn(`Missing value for ${entry.env}; file ${entry.file} was not generated.`);
			continue;
		}

		const state = writeSecretFile(targetPath, value, args);
		summary[state] += 1;

		if (state === "written") {
			console.log(`Generated ${entry.file}`);
		} else if (state === "unchanged") {
			console.log(`Kept ${entry.file} (already up to date)`);
		} else {
			console.log(`Skipped ${entry.file} (exists and differs; use --force to overwrite)`);
		}
	}

	console.log("Summary:", summary);

	if (args.strict && summary.missing > 0) {
		process.exitCode = 1;
		throw new Error("Strict mode enabled and one or more required secret values were missing.");
	}
}

try {
	main();
} catch (error) {
	console.error("Secret bootstrap failed:", error.message || String(error));
	process.exit(1);
}
