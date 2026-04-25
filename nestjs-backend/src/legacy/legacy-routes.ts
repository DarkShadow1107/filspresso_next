import type { INestApplication, LoggerService } from "@nestjs/common";
import type { Express, RequestHandler } from "express";
import { requireFromExpressApi } from "../common/utils/legacy-paths";

export interface LegacyRouteMount {
	domain: string;
	basePath: string;
	modulePath: string;
}

/**
 * Remaining legacy route mounts.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * FULLY MIGRATED TO NESTJS (removed from this list):
 *   auth (session/me/mfa-status/oidc)   → AuthModule
 *   accounts                            → AccountsModule
 *   cards                               → CardsModule
 *   cart                                → CartModule
 *   favorites                           → FavoritesModule
 *   subscriptions                       → SubscriptionsModule
 *   operations                          → OperationsModule
 *   products                            → ProductsModule
 *   orders                              → OrdersModule
 *   chat                                → ChatModule
 *   weather                             → WeatherModule
 *   repairs                             → RepairsModule
 *   subscriptions-engine (Kotlin proxy) → SubscriptionsEngineModule
 *
 * ──────────────────────────────────────────────────────────────────────────
 * STILL DELEGATED TO LEGACY EXPRESS ROUTER (lift-out in progress):
 *
 *   auth-complex  — login/register/OAuth/MFA setup/verify/email-verify
 *                   (security-critical; audited incremental lift required)
 *
 *   admin         — 58 KB IP-allowlisted control plane with TOTP MFA,
 *                   sensitive-view cookie, multer uploads, QRCode generation.
 *                   Highest security risk — independent endpoint audit needed.
 * ──────────────────────────────────────────────────────────────────────────
 */
export const LEGACY_ROUTE_MOUNTS: LegacyRouteMount[] = [];

function loadLegacyRouter(modulePath: string): RequestHandler {
	const module = requireFromExpressApi<unknown>(modulePath);
	if (typeof module !== "function") {
		throw new Error(`Legacy route module ${modulePath} does not export an Express router function`);
	}
	return module as RequestHandler;
}

export function mountLegacyRoutes(app: INestApplication, logger?: LoggerService): void {
	const expressApp = app.getHttpAdapter().getInstance() as Express;

	for (const routeMount of LEGACY_ROUTE_MOUNTS) {
		try {
			const router = loadLegacyRouter(routeMount.modulePath);
			expressApp.use(routeMount.basePath, router);
			logger?.log?.(`Mounted legacy ${routeMount.basePath} from ${routeMount.modulePath}`, "LegacyRouteMount");
		} catch (e) {
			logger?.warn?.(
				`Skipping legacy mount ${routeMount.basePath}: ${e instanceof Error ? e.message : String(e)}`,
				"LegacyRouteMount",
			);
		}
	}
}
