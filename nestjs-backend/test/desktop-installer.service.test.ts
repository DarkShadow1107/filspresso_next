import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DesktopInstallerService } from "../src/desktop/desktop-installer.service";

const { describe, it } = test;

async function withFixture(
	manifestOverrides: Record<string, unknown>,
	run: (service: DesktopInstallerService) => Promise<void>,
) {
	const root = await mkdtemp(path.join(tmpdir(), "filspresso-installer-test-"));
	const directory = path.join(root, "0.3.2");
	const installerPath = path.join(directory, "Filspresso.Playground.msi");
	const manifestPath = path.join(directory, "package-manifest.json");
	const payload = Buffer.from("test MSI payload");
	const sha256 = createHash("sha256").update(payload).digest("hex");
	const originalDir = process.env.DESKTOP_INSTALLER_DIR;
	const originalPath = process.env.DESKTOP_INSTALLER_PATH;
	const originalSigningSecret = process.env.DESKTOP_INSTALLER_SIGNING_SECRET;

	try {
		await mkdir(directory);
		await writeFile(installerPath, payload);
		await writeFile(
			manifestPath,
			`\uFEFF${JSON.stringify({
				version: 1,
				productVersion: "0.3.2",
				file: "Filspresso.Playground.msi",
				bytes: payload.length,
				sha256,
				...manifestOverrides,
			})}`,
			"utf8",
		);
		process.env.DESKTOP_INSTALLER_DIR = root;
		delete process.env.DESKTOP_INSTALLER_PATH;
		delete process.env.DESKTOP_INSTALLER_SIGNING_SECRET;
		await run(new DesktopInstallerService());
	} finally {
		if (originalDir === undefined) delete process.env.DESKTOP_INSTALLER_DIR;
		else process.env.DESKTOP_INSTALLER_DIR = originalDir;
		if (originalPath === undefined) delete process.env.DESKTOP_INSTALLER_PATH;
		else process.env.DESKTOP_INSTALLER_PATH = originalPath;
		if (originalSigningSecret === undefined) delete process.env.DESKTOP_INSTALLER_SIGNING_SECRET;
		else process.env.DESKTOP_INSTALLER_SIGNING_SECRET = originalSigningSecret;
		await rm(root, { recursive: true, force: true });
	}
}

describe("desktop installer manifest verification", () => {
	it("accepts a BOM-prefixed manifest only when the recorded size and SHA-256 match", async () => {
		await withFixture({}, async (service) => {
			const publication = await service.resolve();
			assert.ok(publication);
			assert.equal(publication.version, "0.3.2");
			assert.equal(publication.bytes, 16);
			assert.equal(publication.unsigned, true);
			assert.equal(publication.sha256, createHash("sha256").update("test MSI payload").digest("hex"));
			assert.equal(service.lastFailure, null);
		});
	});

	it("refuses a file whose bytes do not match the manifest", async () => {
		await withFixture({ sha256: "0".repeat(64) }, async (service) => {
			assert.equal(await service.resolve(), null);
			assert.equal(service.lastFailure, "integrity");
		});
	});

	it("requires a valid manifest MAC when signing is configured", async () => {
		await withFixture({}, async (service) => {
			process.env.DESKTOP_INSTALLER_SIGNING_SECRET = "unit-test-signing-secret";
			assert.equal(await service.resolve(), null);
			assert.equal(service.lastFailure, "signature");
		});
	});
});
