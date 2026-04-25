"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_ROUTE_MOUNTS = void 0;
exports.mountLegacyRoutes = mountLegacyRoutes;
const legacy_paths_1 = require("../common/utils/legacy-paths");
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
exports.LEGACY_ROUTE_MOUNTS = [];
function loadLegacyRouter(modulePath) {
    const module = (0, legacy_paths_1.requireFromExpressApi)(modulePath);
    if (typeof module !== "function") {
        throw new Error(`Legacy route module ${modulePath} does not export an Express router function`);
    }
    return module;
}
function mountLegacyRoutes(app, logger) {
    const expressApp = app.getHttpAdapter().getInstance();
    for (const routeMount of exports.LEGACY_ROUTE_MOUNTS) {
        try {
            const router = loadLegacyRouter(routeMount.modulePath);
            expressApp.use(routeMount.basePath, router);
            logger?.log?.(`Mounted legacy ${routeMount.basePath} from ${routeMount.modulePath}`, "LegacyRouteMount");
        }
        catch (e) {
            logger?.warn?.(`Skipping legacy mount ${routeMount.basePath}: ${e instanceof Error ? e.message : String(e)}`, "LegacyRouteMount");
        }
    }
}
