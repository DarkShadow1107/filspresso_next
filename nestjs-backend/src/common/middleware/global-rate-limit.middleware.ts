import type { Request } from "express";
import rateLimit, { type Options } from "express-rate-limit";
import {
	DEFAULT_API_RATE_LIMIT_MAX,
	DEFAULT_API_RATE_LIMIT_WINDOW_MS,
	GLOBAL_RATE_LIMIT_EXCLUDED_PATHS,
} from "../../config/constants";

export function shouldEnableGlobalRateLimit(): boolean {
	const enableRateLimit = process.env.ENABLE_RATE_LIMIT === "true";
	const isProduction = process.env.NODE_ENV === "production";
	const disableForDev = process.env.DISABLE_RATE_LIMIT_FOR_DEV === "true";
	const disableRateLimit = process.env.DISABLE_RATE_LIMIT === "true";

	return enableRateLimit || (isProduction && !disableForDev && !disableRateLimit);
}

export function createGlobalRateLimiter() {
	const windowMs = Math.max(
		60_000,
		Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || String(DEFAULT_API_RATE_LIMIT_WINDOW_MS), 10),
	);
	const max = Math.max(100, Number.parseInt(process.env.API_RATE_LIMIT_MAX || String(DEFAULT_API_RATE_LIMIT_MAX), 10));

	const options: Partial<Options> = {
		windowMs,
		max,
		standardHeaders: true,
		legacyHeaders: false,
		message: { error: "Too many requests, please try again later." },
		skip: (req: Request) => GLOBAL_RATE_LIMIT_EXCLUDED_PATHS.has(req.path),
	};

	return rateLimit(options);
}
