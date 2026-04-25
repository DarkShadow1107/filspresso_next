import fs from "node:fs";
import path from "node:path";

function resolveNestBackendRoot(): string {
	return path.resolve(__dirname, "..", "..", "..");
}

export function resolveRepoRoot(): string {
	return path.resolve(resolveNestBackendRoot(), "..");
}

export function resolveExpressApiPath(...segments: string[]): string {
	// Now mapped to the internal legacy-bridge to allow the external express-api folder to be deleted.
	return path.join(resolveNestBackendRoot(), "src", "legacy-bridge", ...segments);
}

export function requireFromExpressApi<T = unknown>(relativePath: string): T {
	const normalized = relativePath.replace(/^[\\/]+/, "");
	const absolutePath = resolveExpressApiPath(normalized);

	if (!fs.existsSync(absolutePath)) {
		throw new Error(`Express API module was not found at ${absolutePath}`);
	}

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	return require(absolutePath) as T;
}
