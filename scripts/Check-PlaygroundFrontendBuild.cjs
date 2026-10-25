/* Isolated production compile: never replaces the .next tree of a running server.
 * node_modules/public are read-only build inputs by convention; source/config are copies.
 * No .env files, credentials, model weights or application services are copied/restarted.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temporary = process.platform === "win32"
	? path.join(process.env.LOCALAPPDATA || path.join(require("node:os").homedir(), "AppData", "Local"), "Temp", "opencode")
	: process.env.OPENCODE_TEMP_DIR;
if (!temporary) throw new Error("Set OPENCODE_TEMP_DIR to an approved temporary directory.");
fs.mkdirSync(temporary, { recursive: true });
const stage = fs.mkdtempSync(path.join(temporary, "playground-next-check-"));
for (const name of ["src", "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "next-env.d.ts", "global.d.ts", "postcss.config.mjs"])
	if (fs.existsSync(path.join(root, name))) fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
// The shared pure interaction contract has no Nest/runtime/secret dependencies.
const contract = "nestjs-backend/src/desktop/playground-question-contract.ts";
fs.mkdirSync(path.dirname(path.join(stage, contract)), { recursive: true });
fs.copyFileSync(path.join(root, contract), path.join(stage, contract));
for (const name of ["node_modules", "public"])
	fs.symlinkSync(path.join(root, name), path.join(stage, name), process.platform === "win32" ? "junction" : "dir");
console.log(`Isolated Next production build: ${stage}`);
const result = spawnSync(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build", "--webpack"], {
	cwd: stage, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (process.exitCode === 0) console.log("PASS: isolated Next production build. Active .next and application services were not changed.");
