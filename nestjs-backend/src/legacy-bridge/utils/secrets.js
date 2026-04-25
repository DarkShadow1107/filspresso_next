/**
 * Secret loading helpers.
 *
 * Supports loading sensitive values from either environment variables or
 * Docker-style *_FILE locations.
 */

const fs = require("fs");

function readSecretFromFile(secretName, filePath) {
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		const value = String(raw || "").trim();
		if (!value) {
			throw new Error(`${secretName}_FILE points to an empty file`);
		}
		return value;
	} catch (error) {
		throw new Error(`Failed to load ${secretName} from ${secretName}_FILE (${filePath}): ${error.message}`);
	}
}

function getEnvOrFile(secretName, options = {}) {
	const { required = false, defaultValue = "" } = options;

	const directValue = String(process.env[secretName] || "").trim();
	if (directValue) {
		return directValue;
	}

	const filePath = String(process.env[`${secretName}_FILE`] || "").trim();
	if (filePath) {
		const fileValue = readSecretFromFile(secretName, filePath);
		process.env[secretName] = fileValue;
		return fileValue;
	}

	if (required) {
		throw new Error(`${secretName} (or ${secretName}_FILE) environment variable is required`);
	}

	return defaultValue;
}

function preloadSecrets(secretConfigs = []) {
	for (const item of secretConfigs) {
		if (typeof item === "string") {
			getEnvOrFile(item, { required: true });
			continue;
		}

		if (!item || typeof item !== "object" || !item.name) {
			continue;
		}

		getEnvOrFile(item.name, {
			required: Boolean(item.required),
			defaultValue: item.defaultValue,
		});
	}
}

module.exports = {
	getEnvOrFile,
	preloadSecrets,
};
