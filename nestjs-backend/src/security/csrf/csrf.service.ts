import { Injectable } from "@nestjs/common";

@Injectable()
export class CsrfService {
	private readonly isProduction = process.env.NODE_ENV === "production";

	readonly csrfRequireOriginForCookie =
		String(process.env.CSRF_REQUIRE_ORIGIN_FOR_COOKIE || "true")
			.trim()
			.toLowerCase() === "true";

	readonly csrfEnforceFetchMetadata =
		String(process.env.CSRF_ENFORCE_FETCH_METADATA || "true")
			.trim()
			.toLowerCase() === "true";

	readonly configuredOrigins = String(process.env.CORS_ORIGIN || "http://localhost:3000")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

	isAllowedOrigin(origin: string): boolean {
		if (!origin) return true;
		if (this.configuredOrigins.includes(origin)) return true;
		if (!this.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
		return false;
	}
}
