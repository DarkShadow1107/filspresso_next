"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARGON2_OPTIONS = void 0;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.needsPasswordRehash = needsPasswordRehash;
const argon2 = __importStar(require("argon2"));
const bcrypt = require("bcrypt");
const ARGON2_MEMORY_COST_KIB = Math.min(Math.max(Number.parseInt(process.env.ARGON2_MEMORY_COST_KIB || "19456", 10) || 19456, 8 * 1024), 1024 * 1024);
const ARGON2_TIME_COST = Math.min(Math.max(Number.parseInt(process.env.ARGON2_TIME_COST || "3", 10) || 3, 1), 10);
const ARGON2_PARALLELISM = Math.min(Math.max(Number.parseInt(process.env.ARGON2_PARALLELISM || "1", 10) || 1, 1), 8);
const ARGON2_HASH_LENGTH = Math.min(Math.max(Number.parseInt(process.env.ARGON2_HASH_LENGTH || "32", 10) || 32, 16), 64);
exports.ARGON2_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: ARGON2_MEMORY_COST_KIB,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
    hashLength: ARGON2_HASH_LENGTH,
    version: 0x13,
};
function isArgon2Hash(hash) {
    return typeof hash === "string" && hash.startsWith("$argon2id$");
}
function isBcryptHash(hash) {
    return typeof hash === "string" && /^\$2[aby]\$\d{2}\$/.test(hash);
}
async function hashPassword(password) {
    if (typeof password !== "string" || !password) {
        throw new Error("Password must be a non-empty string");
    }
    return argon2.hash(password, exports.ARGON2_OPTIONS);
}
async function verifyPassword(password, passwordHash) {
    if (typeof password !== "string" || typeof passwordHash !== "string" || !passwordHash) {
        return false;
    }
    if (isArgon2Hash(passwordHash)) {
        try {
            return await argon2.verify(passwordHash, password);
        }
        catch {
            return false;
        }
    }
    if (isBcryptHash(passwordHash)) {
        try {
            return await bcrypt.compare(password, passwordHash);
        }
        catch {
            return false;
        }
    }
    return false;
}
function needsPasswordRehash(passwordHash) {
    if (typeof passwordHash !== "string" || !passwordHash) {
        return true;
    }
    if (isArgon2Hash(passwordHash)) {
        try {
            return argon2.needsRehash(passwordHash, exports.ARGON2_OPTIONS);
        }
        catch {
            return true;
        }
    }
    return isBcryptHash(passwordHash);
}
