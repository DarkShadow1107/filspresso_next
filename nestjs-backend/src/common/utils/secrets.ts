import * as fs from "fs";

export function readSecretFromFile(secretName: string, filePath: string): string {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const value = String(raw || "").trim();
    if (!value) {
      throw new Error(`${secretName}_FILE points to an empty file`);
    }
    return value;
  } catch (error: any) {
    throw new Error(`Failed to load ${secretName} from ${secretName}_FILE (${filePath}): ${error.message}`);
  }
}

export function getEnvOrFile(secretName: string, options: { required?: boolean; defaultValue?: string } = {}): string {
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

export function preloadSecrets(secretConfigs: any[] = []): void {
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
