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
exports.DesktopWebController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const desktop_web_service_1 = require("./desktop-web.service");
/**
 * The web tools, for the desktop client.
 *
 * ## Why they are on the server and not in the sandbox
 *
 * The sandbox is a Hyper-V virtual machine with no network adapter, so generated code cannot
 * reach the network. The model still needs to look things up, so the search and the fetch
 * happen here, on the host, and the harness writes the result into the sandbox as a file the
 * model can read. The sandbox never gets a socket, so the boundary is unchanged.
 *
 * The cost of that arrangement is that this endpoint is reachable by anyone who can
 * authenticate, and it can be made to fetch things. It is fenced accordingly -- public
 * addresses only, every redirect re-checked, bodies capped -- and it is rate limited
 * separately from the rest of the API, because an outbound fetch is far more expensive than
 * a database read.
 */
let DesktopWebController = class DesktopWebController {
    web;
    constructor(web) {
        this.web = web;
    }
    /**
     * Search the web, or fetch a page.
     *
     * One endpoint rather than two, because they are one tool from the model's point of view:
     * "give me what the web says about this".
     */
    async tool(req, body) {
        const accountId = Number(req.user?.id);
        if (!Number.isInteger(accountId) || accountId <= 0) {
            return { error: "ACCOUNT_REQUIRED" };
        }
        const action = String(body?.action ?? "search").trim().toLowerCase();
        if (action === "search") {
            const results = await this.web.search(String(body?.query ?? ""), Number(body?.limit ?? 10));
            return { action, results };
        }
        if (action === "fetch") {
            const page = await this.web.fetchPage(String(body?.url ?? ""), Number(body?.limit ?? 20_000));
            return { action, page };
        }
        return { error: "unknown action", action };
    }
};
exports.DesktopWebController = DesktopWebController;
__decorate([
    (0, common_1.Post)("web")
    // 200 rather than Nest's default 201: this returns a result, it does not create
    // anything. A 201 on a tool call tells the client to look for a resource that does not
    // exist.
    ,
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DesktopWebController.prototype, "tool", null);
exports.DesktopWebController = DesktopWebController = __decorate([
    (0, common_1.Controller)("api/desktop"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [desktop_web_service_1.DesktopWebService])
], DesktopWebController);
