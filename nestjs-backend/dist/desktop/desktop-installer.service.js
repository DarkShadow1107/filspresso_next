"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DesktopInstallerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopInstallerService = void 0;
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const common_1 = require("@nestjs/common");
/**
 * Serves the desktop client's installer.
 *
 * The installer is a file the release pipeline produces, not something the backend
 * builds: it is signed and packaged by the desktop project's own CI, and the backend
 * only hands it out. That is why the path is configuration -- the deployment decides
 * where the artefact is mounted -- and why a missing file is a 503 rather than a 404.
 * A 404 would say "this URL does not exist"; the truth is "the app has not been
 * published yet", and the client says so differently.
 */
let DesktopInstallerService = DesktopInstallerService_1 = class DesktopInstallerService {
    logger = new common_1.Logger(DesktopInstallerService_1.name);
    /**
     * Where the installer sits.
     *
     * `DESKTOP_INSTALLER_PATH` overrides it, so a deployment can point at the file it
     * actually published. The default is the mount point the compose file uses.
     */
    get installerPath() {
        const configured = String(process.env["DESKTOP_INSTALLER_PATH"] ?? "").trim();
        return configured || "/app/downloads/Filspresso.Playground.msi";
    }
    /** The name the file is offered under. */
    fileName = "Filspresso.Playground.msi";
    /**
     * Whether an installer is actually there.
     *
     * The client asks this before it offers a download button, so a deployment that has
     * not published the app yet shows nothing rather than a link that fails.
     */
    async isAvailable() {
        try {
            const info = await (0, promises_1.stat)(this.installerPath);
            return info.isFile() && info.size > 0;
        }
        catch {
            return false;
        }
    }
    /**
     * Stream the installer to the browser.
     *
     * Streamed rather than read into memory: the file is over 50 MB, and buffering it
     * per request would put fifty megabytes in the heap for every download in flight.
     */
    async stream(res) {
        const target = this.installerPath;
        let size = 0;
        try {
            const info = await (0, promises_1.stat)(target);
            if (!info.isFile())
                throw new Error("not a file");
            size = info.size;
        }
        catch {
            this.logger.warn(`Desktop installer not found at ${target}`);
            throw new common_1.ServiceUnavailableException({
                error: "INSTALLER_UNAVAILABLE",
                message: "The desktop app has not been published yet. Try again later.",
            });
        }
        res.setHeader("Content-Type", "application/x-msi");
        res.setHeader("Content-Length", String(size));
        res.setHeader("Content-Disposition", `attachment; filename="${this.fileName}"; filename*=UTF-8''${encodeURIComponent(this.fileName)}`);
        // An installer must never be cached by an intermediary: a new build replaces
        // the file at the same path, and a cached copy would be the old one.
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        await new Promise((resolve, reject) => {
            const stream = (0, node_fs_1.createReadStream)(target);
            stream.on("error", reject);
            stream.on("end", resolve);
            stream.pipe(res);
        });
    }
};
exports.DesktopInstallerService = DesktopInstallerService;
exports.DesktopInstallerService = DesktopInstallerService = DesktopInstallerService_1 = __decorate([
    (0, common_1.Injectable)()
], DesktopInstallerService);
