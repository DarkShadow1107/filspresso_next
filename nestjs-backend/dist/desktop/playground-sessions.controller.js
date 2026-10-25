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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaygroundSessionsController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const playground_run_events_service_1 = require("./playground-run-events.service");
const playground_sessions_service_1 = require("./playground-sessions.service");
/** Same shape the sandbox controller already validates with; these ids are client-supplied. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RUN_ID_PATTERN = /^(dsk-[0-9a-f]{24}|exec-[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
function accountId(req) {
    const parsed = Number(req.user?.id);
    if (!Number.isInteger(parsed) || parsed <= 0)
        throw new common_1.BadRequestException("Authentication is required.");
    return parsed;
}
/**
 * Durable Playground state: resume sessions, versioned run replay, deletion controls.
 *
 * Jwt-guarded, because every row is account-scoped data; and every mutation is throttled
 * like the money and load endpoints -- none of these routes are on a hot generation path
 * (chat never waits on them), but a client that wrote a checkpoint every keystroke would
 * still make the sessions table a write amp, so the cheap version of defending it lives here.
 */
let PlaygroundSessionsController = class PlaygroundSessionsController {
    sessions;
    events;
    constructor(sessions, events) {
        this.sessions = sessions;
        this.events = events;
    }
    list(req, limit, offset) {
        return this.sessions.list(accountId(req), Number(limit), Number(offset));
    }
    async create(req, body) {
        try {
            return await this.sessions.create(accountId(req), body ?? {});
        }
        catch (error) {
            if (error instanceof playground_sessions_service_1.InvalidSessionInputError)
                throw new common_1.BadRequestException({ error: "INVALID_SESSION_INPUT", message: error.message });
            throw error;
        }
    }
    get(req, uuid) {
        if (!UUID_PATTERN.test(uuid))
            throw new common_1.BadRequestException("Invalid session id.");
        return this.sessions.get(accountId(req), uuid);
    }
    async update(req, uuid, body) {
        if (!UUID_PATTERN.test(uuid))
            throw new common_1.BadRequestException("Invalid session id.");
        try {
            return await this.sessions.update(accountId(req), uuid, body ?? {});
        }
        catch (error) {
            if (error instanceof playground_sessions_service_1.InvalidSessionInputError)
                throw new common_1.BadRequestException({ error: "INVALID_SESSION_INPUT", message: error.message });
            throw error;
        }
    }
    async delete(req, uuid, purge) {
        if (!UUID_PATTERN.test(uuid))
            throw new common_1.BadRequestException("Invalid session id.");
        const removed = await this.sessions.delete(accountId(req), uuid);
        if (removed && purge === "1") {
            // Retention consent piggybacks on the delete itself: the deleted row is kept as
            // "beyond user sight", and the linked events go with it in the same gesture.
            const purged = await this.events.purgeSessionEvents(accountId(req), uuid);
            return { message: "Session deleted", purgedEvents: purged };
        }
        return { message: "Session deleted" };
    }
    listRuns(req, limit, sessionUuid) {
        if (sessionUuid !== undefined && !UUID_PATTERN.test(sessionUuid))
            throw new common_1.BadRequestException("Invalid session id.");
        return this.events.list(accountId(req), Number(limit), sessionUuid);
    }
    /**
     * Replay one run. Account-scoped twice over: a run id guessed by someone else is simply
     * an empty list, because every query carries the caller's account id first.
     */
    replay(req, runId, limit, afterSequence) {
        if (!RUN_ID_PATTERN.test(runId))
            throw new common_1.BadRequestException("Invalid run id.");
        if (afterSequence !== undefined && (!/^(?:-1|\d+)$/.test(afterSequence) || !Number.isSafeInteger(Number(afterSequence)) || Number(afterSequence) > 2_147_483_647))
            throw new common_1.BadRequestException("Invalid event cursor.");
        return this.events.replay(accountId(req), runId, Number(limit), afterSequence === undefined ? -1 : Number(afterSequence));
    }
    /** Deletion control for run history: one session's events, or the whole account's when sessionUuid is absent. */
    async purge(req, sessionUuid) {
        const caller = accountId(req);
        if (sessionUuid) {
            if (!UUID_PATTERN.test(sessionUuid))
                throw new common_1.BadRequestException("Invalid session id.");
            const purged = await this.events.purgeSessionEvents(caller, sessionUuid);
            return { message: "Run history purged", purgedEvents: purged };
        }
        const purged = await this.events.purgeAccountEvents(caller);
        return { message: "Run history purged", purgedEvents: purged };
    }
};
exports.PlaygroundSessionsController = PlaygroundSessionsController;
__decorate([
    (0, common_1.Get)("sessions"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("limit")),
    __param(2, (0, common_1.Query)("offset")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PlaygroundSessionsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)("sessions"),
    (0, throttler_1.Throttle)({ default: { limit: 30, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PlaygroundSessionsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)("sessions/:uuid"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("uuid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PlaygroundSessionsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)("sessions/:uuid"),
    (0, throttler_1.Throttle)({ default: { limit: 60, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("uuid")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], PlaygroundSessionsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)("sessions/:uuid"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("uuid")),
    __param(2, (0, common_1.Query)("purge")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], PlaygroundSessionsController.prototype, "delete", null);
__decorate([
    (0, common_1.Get)("runs"),
    (0, common_1.Header)("Cache-Control", "no-store"),
    (0, throttler_1.Throttle)({ default: { limit: 60, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("limit")),
    __param(2, (0, common_1.Query)("sessionUuid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PlaygroundSessionsController.prototype, "listRuns", null);
__decorate([
    (0, common_1.Get)("runs/:runId"),
    (0, common_1.Header)("Cache-Control", "no-store"),
    (0, throttler_1.Throttle)({ default: { limit: 120, ttl: 60_000 } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("runId")),
    __param(2, (0, common_1.Query)("limit")),
    __param(3, (0, common_1.Query)("afterSequence")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], PlaygroundSessionsController.prototype, "replay", null);
__decorate([
    (0, common_1.Delete)("runs"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("sessionUuid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PlaygroundSessionsController.prototype, "purge", null);
exports.PlaygroundSessionsController = PlaygroundSessionsController = __decorate([
    (0, common_1.Controller)("api/playground"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [playground_sessions_service_1.PlaygroundSessionsService,
        playground_run_events_service_1.PlaygroundRunEventsService])
], PlaygroundSessionsController);
