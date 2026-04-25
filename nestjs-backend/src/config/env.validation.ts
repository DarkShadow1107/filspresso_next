import Joi from "joi";

export const envValidationSchema = Joi.object({
	NODE_ENV: Joi.string().valid("development", "test", "production").default("production"),
	PORT: Joi.number().integer().min(1).max(65535).default(4000),
	TRUST_PROXY: Joi.string().allow("", "0", "1", "true", "false").optional(),
	CORS_ORIGIN: Joi.string().min(1).default("http://localhost:3000"),
	REQUEST_TIMEOUT_MS: Joi.number().integer().min(5000).max(120000).default(20000),
	API_RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(60000).default(900000),
	API_RATE_LIMIT_MAX: Joi.number().integer().min(100).default(1200),
	ENABLE_RATE_LIMIT: Joi.boolean().truthy("true").falsy("false").default(false),
	DISABLE_RATE_LIMIT: Joi.boolean().truthy("true").falsy("false").default(false),
	DISABLE_RATE_LIMIT_FOR_DEV: Joi.boolean().truthy("true").falsy("false").default(true),
	DB_HOST: Joi.string().min(1).default("localhost"),
	DB_PORT: Joi.number().integer().min(1).max(65535).default(5432),
	DB_NAME: Joi.string().min(1).default("filspresso"),
	DB_USER: Joi.string().min(1).default("filspresso_user"),
	PYTHON_AI_HOST: Joi.string()
		.uri({ scheme: ["http", "https"] })
		.default("http://localhost:5000"),
	OPA_URL: Joi.string().allow("").optional(),
	OPA_TIMEOUT_MS: Joi.number().integer().min(250).max(10000).default(1500),
	OPA_FAIL_CLOSED: Joi.boolean().truthy("true").falsy("false").default(false),
});
