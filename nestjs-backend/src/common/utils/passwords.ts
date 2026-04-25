import * as argon2 from "argon2";

const bcrypt: any = require("bcrypt");

const ARGON2_MEMORY_COST_KIB = Math.min(
  Math.max(Number.parseInt(process.env.ARGON2_MEMORY_COST_KIB || "19456", 10) || 19456, 8 * 1024),
  1024 * 1024,
);
const ARGON2_TIME_COST = Math.min(Math.max(Number.parseInt(process.env.ARGON2_TIME_COST || "3", 10) || 3, 1), 10);
const ARGON2_PARALLELISM = Math.min(Math.max(Number.parseInt(process.env.ARGON2_PARALLELISM || "1", 10) || 1, 1), 8);
const ARGON2_HASH_LENGTH = Math.min(Math.max(Number.parseInt(process.env.ARGON2_HASH_LENGTH || "32", 10) || 32, 16), 64);

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: ARGON2_MEMORY_COST_KIB,
  timeCost: ARGON2_TIME_COST,
  parallelism: ARGON2_PARALLELISM,
  hashLength: ARGON2_HASH_LENGTH,
  version: 0x13,
};

function isArgon2Hash(hash: string): boolean {
  return typeof hash === "string" && hash.startsWith("$argon2id$");
}

function isBcryptHash(hash: string): boolean {
  return typeof hash === "string" && /^\$2[aby]\$\d{2}\$/.test(hash);
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || !password) {
    throw new Error("Password must be a non-empty string");
  }

  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (typeof password !== "string" || typeof passwordHash !== "string" || !passwordHash) {
    return false;
  }

  if (isArgon2Hash(passwordHash)) {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  if (isBcryptHash(passwordHash)) {
    try {
      return await bcrypt.compare(password, passwordHash);
    } catch {
      return false;
    }
  }

  return false;
}

export function needsPasswordRehash(passwordHash: string): boolean {
  if (typeof passwordHash !== "string" || !passwordHash) {
    return true;
  }

  if (isArgon2Hash(passwordHash)) {
    try {
      return argon2.needsRehash(passwordHash, ARGON2_OPTIONS);
    } catch {
      return true;
    }
  }

  return isBcryptHash(passwordHash);
}
