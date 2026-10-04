"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OptionalJwtAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const active_session_service_1 = require("./active-session.service");
let OptionalJwtAuthGuard = class OptionalJwtAuthGuard {
    activeSessions;
    constructor(activeSessions) {
        this.activeSessions = activeSessions;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        // A revoked or expired session is treated exactly like no session at all,
        // so protected routes fall back to their anonymous behaviour.
        const session = await this.activeSessions.resolve(request);
        if (session) {
            request.user = session.claims;
        }
        return true; // Always allow, just populate user if the session is live
    }
};
exports.OptionalJwtAuthGuard = OptionalJwtAuthGuard;
exports.OptionalJwtAuthGuard = OptionalJwtAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [active_session_service_1.ActiveSessionService])
], OptionalJwtAuthGuard);
