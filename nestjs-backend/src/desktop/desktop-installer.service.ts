import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";

export type InstallerPublication = {
	/** The MSI on disk, resolved. */
	path: string;
	fileName: string;
	/**
	 * Manifest `productVersion` or the version-directory name. Null only for a legacy
	 * single-file publication with no manifest at all -- such a publication cannot feed
	 * the acknowledgement gate and never wins over a managed release.
	 */
	version: string | null;
	/** Bytes as recorded in the manifest; the real file size is re-checked against it. */
	bytes: number | null;
	/** SHA-256 recorded in the manifest, lowercase. */
	sha256: string | null;
	/** MAC over {file, bytes, sha256}, when the publisher signed the manifest. */
	signature: string | null;
	/** True when the manifest carries no signature. The package bytes can still be hash-verified. */
	unsigned: boolean;
};

type VerifyOutcome = "ok" | "integrity" | "signature";

/**
 * Serves the desktop client's installer.
 *
 * The installer is a file the release pipeline produces, not something the backend
 * builds: it is packaged by the desktop project's own build, and the backend only hands
 * it out. That is why the location is configuration -- the deployment decides where the
 * artefact is mounted -- and why a missing file is a 503 rather than a 404. A 404 would
 * say "this URL does not exist"; the truth is "the app has not been published yet", and
 * the client says so differently.
 *
 * What versioned storage adds: the file is no longer trusted just because it sits where
 * the deployment pointed. Each publication carries a `package-manifest.json` with its
 * own size and SHA-256, and this service re-hashes the real file on disk before it
 * streams anything. A file that grew, shrank or was swapped out is a 503, never a
 * download -- that closes the "someone swapped the volume and every served copy was
 * silently the swapped bytes" failure mode.
 *
 * Layouts, in order of preference:
 * - `DESKTOP_INSTALLER_DIR/<version>/Filspresso.Playground.msi` + `package-manifest.json`
 * - `DESKTOP_INSTALLER_DIR/Filspresso.Playground.msi` + manifest beside it (single-file layout)
 * - `DESKTOP_INSTALLER_PATH=<file>` overrides everything; the manifest beside it is advisory.
 *
 * The newest version wins. When `DESKTOP_INSTALLER_SIGNING_SECRET` is set, a manifest
 * without a MAC -- or with a MAC that does not verify against the secret -- is treated as
 * a signature failure, so a rewritten manifest cannot simply drop the signature to pass.
 */
@Injectable()
export class DesktopInstallerService {
	private readonly logger = new Logger(DesktopInstallerService.name);

	/** The name the file is offered under. */
	readonly fileName = "Filspresso.Playground.msi";

	private cache = { key: "", publication: null as InstallerPublication | null, fetchedAt: 0 };
	/** Why the last publication check failed, surfaced by the download route's 503. */
	lastFailure: "unavailable" | "integrity" | "signature" | null = null;
	private static readonly cacheTtlMs = 15_000;

	/** Base directory the publication is searched in. `/app/downloads` is the compose mount point. */
	private get dirPath(): string {
		const configured = String(process.env["DESKTOP_INSTALLER_DIR"] ?? "").trim();
		return configured || "/app/downloads";
	}

	/** Single-file override, honoured before any directory scan. */
	private get legacyPath(): string {
		return String(process.env["DESKTOP_INSTALLER_PATH"] ?? "").trim();
	}

	/**
	 * Whether an installer is actually there, and whether it still matches its manifest.
	 *
	 * The client asks this before it offers a download button, so a deployment that has
	 * not published the app yet shows nothing rather than a link that fails. A file whose
	 * hash no longer matches its manifest is reported as unavailable rather than served:
	 * a publication that cannot prove its own integrity must not move.
	 */
	async isAvailable(): Promise<boolean> {
		return (await this.resolve()) !== null;
	}

	/**
	 * The publication that would be served, or null when none is compliant.
	 *
	 * All candidates (version directories and, failing that, the flat file) are collected
	 * and the newest version wins. Never throws: a signing-secret mismatch, an unhashable
	 * file or an absent manifest all resolve to null with `lastFailure` recorded, so the
	 * metadata endpoint keeps answering and the button stays off.
	 */
	async resolve(): Promise<InstallerPublication | null> {
		const key = `${this.legacyPath}|${this.dirPath}`;
		if (this.cache.publication && key === this.cache.key && Date.now() - this.cache.fetchedAt < DesktopInstallerService.cacheTtlMs) {
			return this.cache.publication;
		}
		const resolved = await this.scan();
		this.cache = { key, publication: resolved, fetchedAt: Date.now() };
		return resolved;
	}

	private async scan(): Promise<InstallerPublication | null> {
		const candidates: InstallerPublication[] = [];
		this.lastFailure = "unavailable";

		const legacyFile = this.legacyPath;
		if (legacyFile) {
			candidates.push(...(await this.publications(dirname(legacyFile), basename(legacyFile))));
		} else {
			for (const entry of await this.directoryEntries(this.dirPath)) {
				const child = join(this.dirPath, entry);
				const childStat = await stat(child).catch(() => null);
				if (childStat?.isDirectory() && /^v?[0-9]+(\.[0-9]+){1,3}$/.test(entry)) {
					candidates.push(...(await this.publications(child, this.fileName, entry.replace(/^v/, ""))));
				}
			}
			// The single-file layout: an MSI directly in the mounted directory, with its
			// manifest beside it when the publisher produced one.
			candidates.push(...(await this.publications(this.dirPath, this.fileName)));
		}

		const compliant: InstallerPublication[] = [];
		for (const candidate of candidates) {
			const outcome = await this.verify(candidate);
			if (outcome === "ok") {
				compliant.push(candidate);
				this.lastFailure = null;
			} else {
				this.lastFailure = outcome;
			}
		}

		// Latest wins. A publication without a resolvable version can only win when it is
		// alone, so a stale un-versioned file can never shadow a newer managed release.
		const versioned = compliant.filter((candidate) => candidate.version !== null);
		const sorted = versioned.slice().sort((a, b) => compareVersions(a.version as string, b.version as string));
		return sorted[sorted.length - 1] ?? compliant[compliant.length - 1] ?? null;
	}

	private async directoryEntries(path: string): Promise<string[]> {
		try {
			return await readdir(path);
		} catch {
			return [];
		}
	}

	private async publications(
		directory: string,
		fileName: string,
		directoryVersion: string | null = null,
	): Promise<InstallerPublication[]> {
		const path = join(directory, fileName);
		const info = await stat(path).catch(() => null);
		if (!info || !info.isFile() || info.size <= 0) return [];

		let bytes: number | null = null;
		let sha256: string | null = null;
		let signature: string | null = null;
		let version = directoryVersion;
		try {
			const manifest = JSON.parse(await readFile(join(directory, "package-manifest.json"), "utf8")) as Record<string, unknown>;
			if (typeof manifest.productVersion === "string" && /^[0-9]+(\.[0-9]+){1,3}$/.test(manifest.productVersion)) {
				version = manifest.productVersion;
			}
			if (typeof manifest.bytes === "number" && Number.isInteger(manifest.bytes) && manifest.bytes > 0) {
				bytes = manifest.bytes;
			}
			if (typeof manifest.sha256 === "string" && /^[0-9a-f]{64}$/i.test(manifest.sha256)) {
				sha256 = manifest.sha256.toLowerCase();
			}
			if (typeof manifest.signature === "string" && /^[0-9a-f]{64,512}$/i.test(manifest.signature)) {
				signature = manifest.signature.toLowerCase();
			}
		} catch {
			// No manifest (or an unreadable one): bytes/sha256/signature stay null and the
			// verify() step decides whether that publication may be served.
		}
		return [{ path, fileName, version, bytes, sha256, signature, unsigned: signature === null }];
	}

	/**
	 * The integrity check itself. Confirms the manifest's MAC (when one is configured),
	 * the real file size, and the real SHA-256 -- in that order, because they catch an
	 * attacker rewriting from the cheapest to the most expensive to fake.
	 */
	private async verify(publication: InstallerPublication): Promise<VerifyOutcome> {
		const secret = String(process.env["DESKTOP_INSTALLER_SIGNING_SECRET"] ?? "").trim();
		if (secret) {
			if (!publication.signature || !macMatches(macPayload(publication), secret, publication.signature)) {
				this.logger.warn(`Desktop installer manifest signature mismatch for ${publication.version ?? publication.path}`);
				return "signature";
			}
		}

		const info = await stat(publication.path).catch(() => null);
		if (!info || !info.isFile() || info.size <= 0) return "integrity";
		if (publication.bytes !== null && info.size !== publication.bytes) {
			this.logger.warn(
				`Desktop installer size mismatch at ${publication.path}: manifest ${publication.bytes}, disk ${info.size}`,
			);
			return "integrity";
		}
		if (publication.sha256 === null) {
			this.logger.warn(`Desktop installer manifest for ${publication.path} records no sha256; refusing to serve unverified bytes.`);
			return "integrity";
		}

		const hash = await hashFile(publication.path);
		if (hash !== publication.sha256) {
			this.logger.warn(
				`Desktop installer hash mismatch at ${publication.path}: manifest ${publication.sha256}, disk ${hash}`,
			);
			return "integrity";
		}
		return "ok";
	}

	/**
	 * Stream the installer to the browser with the checksum header, so the download can
	 * be verified independently of this route.
	 *
	 * Streamed rather than read into memory: the file is over 50 MB, and buffering it
	 * per request would put fifty megabytes in the heap for every download in flight.
	 */
	async stream(res: Response): Promise<{ publication: InstallerPublication }> {
		const target = await this.resolve();
		if (!target) {
			this.logger.warn(`Desktop installer unavailable (${this.lastFailure ?? "not found"})`);
			throw new ServiceUnavailableException({
				error: "INSTALLER_UNAVAILABLE",
				message: "The desktop app has not been published yet. Try again later.",
			});
		}
		// Re-verify at the moment of streaming: between the metadata call and this one the
		// volume may have been replaced by a different build. Belt and braces with the
		// resolve() check -- the race is the thing this protects against.
		const outcome = await this.verify(target);
		if (outcome !== "ok") {
			throw new ServiceUnavailableException({
				error: outcome === "signature" ? "INSTALLER_SIGNATURE" : "INSTALLER_INTEGRITY",
				message: "The desktop app package failed its integrity check and was not downloaded.",
			});
		}

		const headers: Record<string, string> = {
			"Content-Type": "application/x-msi",
			"Content-Disposition": `attachment; filename="${this.fileName}"; filename*=UTF-8''${encodeURIComponent(this.fileName)}`,
			// An installer must never be cached by an intermediary: a new build replaces
			// the file at the same path, and a cached copy would be the old one.
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		};
		if (target.sha256) {
			headers["X-Checksum-Sha256"] = target.sha256;
		}
		if (target.version) {
			headers["X-Package-Version"] = target.version;
		}

		res.writeHead(200, headers);
		await new Promise<void>((resolve, reject) => {
			const stream = createReadStream(target.path);
			stream.on("error", reject);
			stream.on("end", resolve);
			stream.pipe(res);
		});
		return { publication: target };
	}
}

function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const da = pa[i] ?? 0;
		const db = pb[i] ?? 0;
		if (da !== db) return da - db;
	}
	return a.localeCompare(b);
}

/** The message the publisher's MAC covers: exactly the fields a swap could change. */
function macPayload(publication: InstallerPublication): string {
	return `${publication.fileName}:${publication.bytes ?? ""}:${publication.sha256 ?? ""}`;
}

export function computeInstallerMac(publication: InstallerPublication, secret: string): string {
	return createHash("sha256").update(`${secret}:${macPayload(publication)}`).digest("hex");
}

function macMatches(payloadMessage: string, secret: string, provided: string): boolean {
	const expected = createHash("sha256").update(`${secret}:${payloadMessage}`).digest("hex");
	if (expected.length !== provided.length) return false;
	let mismatch = 0;
	for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
	return mismatch === 0;
}

async function hashFile(path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(path);
		stream.on("data", (chunk) => hash.update(chunk as Buffer));
		stream.on("error", reject);
		stream.on("end", () => resolve(hash.digest("hex")));
	});
}
