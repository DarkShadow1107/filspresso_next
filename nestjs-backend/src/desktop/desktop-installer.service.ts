import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";

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
@Injectable()
export class DesktopInstallerService {
	private readonly logger = new Logger(DesktopInstallerService.name);

	/**
	 * Where the installer sits.
	 *
	 * `DESKTOP_INSTALLER_PATH` overrides it, so a deployment can point at the file it
	 * actually published. The default is the mount point the compose file uses.
	 */
	private get installerPath(): string {
		const configured = String(process.env["DESKTOP_INSTALLER_PATH"] ?? "").trim();
		return configured || "/app/downloads/Filspresso.Playground.msi";
	}

	/** The name the file is offered under. */
	readonly fileName = "Filspresso.Playground.msi";

	/**
	 * Whether an installer is actually there.
	 *
	 * The client asks this before it offers a download button, so a deployment that has
	 * not published the app yet shows nothing rather than a link that fails.
	 */
	async isAvailable(): Promise<boolean> {
		try {
			const info = await stat(this.installerPath);
			return info.isFile() && info.size > 0;
		} catch {
			return false;
		}
	}

	/**
	 * Stream the installer to the browser.
	 *
	 * Streamed rather than read into memory: the file is over 50 MB, and buffering it
	 * per request would put fifty megabytes in the heap for every download in flight.
	 */
	async stream(res: Response): Promise<void> {
		const target = this.installerPath;
		let size = 0;
		try {
			const info = await stat(target);
			if (!info.isFile()) throw new Error("not a file");
			size = info.size;
		} catch {
			this.logger.warn(`Desktop installer not found at ${target}`);
			throw new ServiceUnavailableException({
				error: "INSTALLER_UNAVAILABLE",
				message: "The desktop app has not been published yet. Try again later.",
			});
		}

		res.setHeader("Content-Type", "application/x-msi");
		res.setHeader("Content-Length", String(size));
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${this.fileName}"; filename*=UTF-8''${encodeURIComponent(this.fileName)}`,
		);
		// An installer must never be cached by an intermediary: a new build replaces
		// the file at the same path, and a cached copy would be the old one.
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("X-Content-Type-Options", "nosniff");

		await new Promise<void>((resolve, reject) => {
			const stream = createReadStream(target);
			stream.on("error", reject);
			stream.on("end", resolve);
			stream.pipe(res);
		});
	}
}
