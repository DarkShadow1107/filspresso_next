"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthGuardModule = void 0;
const common_1 = require("@nestjs/common");
const active_session_service_1 = require("./active-session.service");
const jwt_auth_guard_1 = require("./jwt-auth.guard");
const optional_jwt_auth_guard_1 = require("./optional-jwt-auth.guard");
const session_store_service_1 = require("./session-store.service");
// Registered globally so every controller that references the guards by class
// resolves the DI-aware instance rather than a bare `new`.
let AuthGuardModule = class AuthGuardModule {
};
exports.AuthGuardModule = AuthGuardModule;
exports.AuthGuardModule = AuthGuardModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            session_store_service_1.SessionStoreService,
            active_session_service_1.ActiveSessionService,
            jwt_auth_guard_1.JwtAuthGuard,
            optional_jwt_auth_guard_1.OptionalJwtAuthGuard,
        ],
        exports: [
            session_store_service_1.SessionStoreService,
            active_session_service_1.ActiveSessionService,
            jwt_auth_guard_1.JwtAuthGuard,
            optional_jwt_auth_guard_1.OptionalJwtAuthGuard,
        ],
    })
], AuthGuardModule);
