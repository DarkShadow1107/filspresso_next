#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    outDir: "secrets",
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--force") {
      args.force = true;
      continue;
    }
    if (token === "--out-dir" && argv[i + 1]) {
      args.outDir = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    ...options,
  });

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${command} ${commandArgs.join(" ")}`);
  }
  if (result.error) {
    throw result.error;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(process.cwd(), args.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  run("docker", ["--version"]);

  const shellScript = String.raw`
set -eu

apk add --no-cache openssl >/dev/null

should_generate() {
  target="$1"
  if [ "\${FORCE:-0}" = "1" ]; then
    return 0
  fi

  if [ ! -s "$target" ]; then
    return 0
  fi

  if grep -q "REPLACE_WITH_" "$target"; then
    return 0
  fi

  current_value="$(tr -d '\r\n' < "$target" || true)"
  case "$current_value" in
    replace-with-*|change-this-*|db-*|backend-db-*|ai-db-*|redis-*|ops-*|events-*|jwt-*)
      return 0
      ;;
  esac

  return 1
}

write_secret() {
  target="$1"
  value="$2"
  if should_generate "$target"; then
    printf '%s\n' "$value" > "$target"
    chmod 644 "$target" || true
    echo "generated $target"
  else
    echo "kept $target"
  fi
}

write_secret db_password.txt "$(openssl rand -hex 32)"
write_secret backend_db_password.txt "$(openssl rand -hex 32)"
write_secret ai_db_password.txt "$(openssl rand -hex 32)"
write_secret redis_password.txt "$(openssl rand -hex 32)"
write_secret go_ops_api_key.txt "$(openssl rand -hex 32)"
write_secret jwt_secret.txt "$(openssl rand -base64 48 | tr -d '\n')"
write_secret service_events_api_key.txt "$(openssl rand -hex 32)"
write_secret encryption_key.txt "base64:$(openssl rand -base64 32 | tr -d '\n')"
write_secret vault_kek.txt "base64:$(openssl rand -base64 32 | tr -d '\n')"

if should_generate jwt_signing_private_key.pem; then
  openssl genpkey -algorithm Ed25519 -out jwt_signing_private_key.pem
  chmod 644 jwt_signing_private_key.pem || true
  openssl pkey -in jwt_signing_private_key.pem -pubout -out jwt_signing_public_key.pem
  chmod 644 jwt_signing_public_key.pem || true
  echo "generated jwt_signing_private_key.pem"
  echo "generated jwt_signing_public_key.pem"
elif should_generate jwt_signing_public_key.pem; then
  openssl pkey -in jwt_signing_private_key.pem -pubout -out jwt_signing_public_key.pem
  chmod 644 jwt_signing_public_key.pem || true
  echo "generated jwt_signing_public_key.pem"
else
  echo "kept jwt_signing_private_key.pem"
  echo "kept jwt_signing_public_key.pem"
fi

if should_generate ledger_anchor_private_key.pem; then
  openssl genpkey -algorithm Ed25519 -out ledger_anchor_private_key.pem
  chmod 644 ledger_anchor_private_key.pem || true
  echo "generated ledger_anchor_private_key.pem"
else
  echo "kept ledger_anchor_private_key.pem"
fi
`;

  run("docker", [
    "run",
    "--rm",
    "-e",
    `FORCE=${args.force ? "1" : "0"}`,
    "-v",
    `${outDir}:/work`,
    "-w",
    "/work",
    "alpine:3.20",
    "sh",
    "-ec",
    shellScript,
  ]);

  console.log(`Secrets generated in ${outDir}`);
}

try {
  main();
} catch (error) {
  console.error("Docker secrets generation failed:", error.message || String(error));
  process.exit(1);
}
