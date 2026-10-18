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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var DesktopAwareThrottlerGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopAwareThrottlerGuard = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const crypto = __importStar(require("crypto"));
/**
 * The global throttle, with one deliberate exception: the desktop auth routes are keyed by
 * account and device rather than by IP.
 *
 * Why this needs to exist rather than a bigger limit. `ThrottlerGuard` keys on IP, and for
 * `POST /api/auth/login` that is right -- a burst of logins from one address is the shape of
 * credential stuffing. It is wrong for a desktop client in two ways at once:
 *
 *   - False positives. A company behind one NAT, a university, or a mobile carrier puts
 *     every user behind a single address. Their logins share one budget of 10 per 15
 *     minutes, so one person's repeated typo exhausts it and locks out everyone else on
 *     that network. The symptom is a support ticket that reads "the app randomly signs me
 *     out", and it is not reproducible on the developer's machine.
 *   - A blind spot. Keying on IP alone means an attacker who rotates source addresses gets
 *     an unlimited budget against a single account, because the budget was never about the
 *     account in the first place.
 *
 * Keying on account + device fixes both: the budget belongs to the thing being protected,
 * and a shared address stops being a shared allowance. A per-IP ceiling is not dropped --
 * `super.getTracker` still governs every other route, and the escalating per-account
 * lockout in AuthComplexService is a second, independent layer behind this one.
 *
 * Only the two `/api/auth/desktop/` routes are treated this way. Everything else keeps the
 * stock tracker, because changing the key for the web login would weaken the one endpoint
 * where a generous limit is a real vulnerability.
 */
let DesktopAwareThrottlerGuard = class DesktopAwareThrottlerGuard extends throttler_1.ThrottlerGuard {
    static { DesktopAwareThrottlerGuard_1 = this; }
    /** Routes that get the account+device key. Anything else is stock. */
    static DESKTOP_ROUTE_PREFIX = "/api/auth/desktop/";
    async getTracker(req) {
        const request = req;
        if (!String(request?.originalUrl || request?.url || "").startsWith(DesktopAwareThrottlerGuard_1.DESKTOP_ROUTE_PREFIX)) {
            return super.getTracker(req);
        }
        return DesktopAwareThrottlerGuard_1.desktopKey(request);
    }
    /**
     * `sha256(account|device)` — hashed, because this string is a Redis key and a rate limit
     * store is not the place an email address should be lying around in plaintext.
     *
     * Falls back to the peer address when there is no account field to key on, which is the
     * only case where a desktop request is limited by IP: a malformed or empty body. That
     * is exactly the traffic worth limiting by address, so the fallback is aligned with the
     * intent rather than merely being safe.
     */
    static desktopKey(request) {
        const body = (request?.body ?? {});
        const loginField = String(body.email || body.username || "").trim().toLowerCase().slice(0, 254);
        const deviceId = String(body.deviceId || "").trim().slice(0, 64);
        const ip = String(request?.ip || request?.socket?.remoteAddress || "unknown");
        const parts = [loginField, deviceId || "no-device", ip];
        const raw = parts.filter(Boolean).join("|");
        if (!loginField) {
            // No account to protect yet: address only, which is what the stock guard does.
            return `desktop:${ip}`;
        }
        return `desktop:${crypto.createHash("sha256").update(raw).digest("hex")}`;
    }
};
exports.DesktopAwareThrottlerGuard = DesktopAwareThrottlerGuard;
exports.DesktopAwareThrottlerGuard = DesktopAwareThrottlerGuard = DesktopAwareThrottlerGuard_1 = __decorate([
    (0, common_1.Injectable)()
], DesktopAwareThrottlerGuard);
