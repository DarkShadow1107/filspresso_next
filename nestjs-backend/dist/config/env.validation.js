"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.envValidationSchema = void 0;
const joi_1 = __importDefault(require("joi"));
exports.envValidationSchema = joi_1.default.object({
    NODE_ENV: joi_1.default.string().valid("development", "test", "production").default("production"),
    PORT: joi_1.default.number().integer().min(1).max(65535).default(4000),
    TRUST_PROXY: joi_1.default.string().allow("", "0", "1", "true", "false").optional(),
    CORS_ORIGIN: joi_1.default.string().min(1).default("http://localhost:3000"),
    REQUEST_TIMEOUT_MS: joi_1.default.number().integer().min(5000).max(120000).default(20000),
    API_RATE_LIMIT_WINDOW_MS: joi_1.default.number().integer().min(60000).default(900000),
    API_RATE_LIMIT_MAX: joi_1.default.number().integer().min(100).default(1200),
    ENABLE_RATE_LIMIT: joi_1.default.boolean().truthy("true").falsy("false").default(false),
    DISABLE_RATE_LIMIT: joi_1.default.boolean().truthy("true").falsy("false").default(false),
    DISABLE_RATE_LIMIT_FOR_DEV: joi_1.default.boolean().truthy("true").falsy("false").default(true),
    DB_HOST: joi_1.default.string().min(1).default("localhost"),
    DB_PORT: joi_1.default.number().integer().min(1).max(65535).default(5432),
    DB_NAME: joi_1.default.string().min(1).default("filspresso"),
    DB_USER: joi_1.default.string().min(1).default("filspresso_user"),
    PYTHON_AI_HOST: joi_1.default.string()
        .uri({ scheme: ["http", "https"] })
        .default("http://localhost:5000"),
    OPA_URL: joi_1.default.string().allow("").optional(),
    OPA_TIMEOUT_MS: joi_1.default.number().integer().min(250).max(10000).default(1500),
    OPA_FAIL_CLOSED: joi_1.default.boolean().truthy("true").falsy("false").default(false),
});
