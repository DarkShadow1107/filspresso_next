import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

const BACKEND_ROOT = path.resolve(__dirname, "..");
const CONTROLLER = path.resolve(BACKEND_ROOT, "src", "desktop", "desktop.controller.ts");
const INSTALLER = path.resolve(BACKEND_ROOT, "src", "desktop", "desktop-installer.service.ts");
const REGISTRY = path.resolve(BACKEND_ROOT, "src", "desktop", "desktop-installer-registry.service.ts");
const SCHEMA = path.resolve(BACKEND_ROOT, "src", "database", "ensureAppSchema.ts");
const POLICY = path.resolve(BACKEND_ROOT, "src", "config", "rate-limit.policy.ts");
const MODULE = path.resolve(BACKEND_ROOT, "src", "desktop", "desktop.module.ts");

const controller = readFileSync(CONTROLLER, "utf8");
const installer = readFileSync(INSTALLER, "utf8");
const registry = readFileSync(REGISTRY, "utf8");
const schema = readFileSync(SCHEMA, "utf8");
const policy = readFileSync(POLICY, "utf8");
const moduleSource = readFileSync(MODULE, "utf8");

/**
 * The installer delivery path, as source contract.
 *
 * The gate between a browser and an 80 MB file is the kind of thing that quietly rots:
 * a refactor that drops one check leaves an endpoint that still works, and nothing
 * anywhere else notices. These assert the order and existence of the refusals in the
 * source itself, the same way desktop-catalogue.test.ts pins the auth and throttler
 * wiring. They complement the unit tests the desktop client carries for its own side
 * and cannot stand in for a live download.
 */
describe("desktop installer pipeline (source contract)", () => {
  it("the download route does not stream before Spectre, publication and recorded acknowledgement", () => {
    // Exact order of the gates inside download(): access -> publication -> ack -> stream.
    // Anchored on the route block, because the same strings appear in the other routes.
    const start = controller.indexOf('@Get("download")');
    const end = controller.indexOf('@Get("installations")');
    assert.ok(start >= 0 && end > start, "download route not found");
    const download = controller.slice(start, end);

    const access = download.indexOf("!access.hasAccess");
    const publication = download.indexOf('error: "INSTALLER_UNAVAILABLE"');
    const ack = download.indexOf('error: "ACKNOWLEDGEMENT_REQUIRED"');
    const stream = download.indexOf("installer.stream(res)");
    assert.ok(access >= 0, "download does not check Spectre access");
    assert.ok(publication > access, "publication refusal must follow the access check");
    assert.ok(ack > publication, "acknowledgement gate must follow the publication resolve");
    assert.ok(stream > ack, "download streams before the acknowledgement gate");
    // The gate consults the server-recorded ack, never the request body or a UI state.
    assert.match(download, /installerRegistry\.hasAck\(accountId, publication\.version\)/, "download gate must consult the recorded ack");
  });

  it("the recorded ack is refreshed before the download, not only by the popup", () => {
    // Covered by the anchored gates above; kept as a named case so a failure here reads
    // as "the gate reads server state", which is the property being defended.
    assert.match(controller, /installerRegistry\.hasAck\(accountId, publication\.version\)/, "download gate must consult the recorded ack");
  });

  it("the audit row is written after the stream and its failure cannot fail the download", () => {
    const stream = controller.indexOf("installer.stream(res)");
    const audit = controller.indexOf("installerRegistry.recordDownload");
    const guarded = /Desktop download audit write failed/.test(controller);
    assert.ok(stream >= 0 && audit > stream, "download audit must follow the stream");
    assert.ok(guarded, "an audit failure after streaming must be logged, not converted into an HTTP error");
  });

  it("the acknowledgement route refuses Spectre-less accounts and drifted versions", () => {
    assert.match(controller, /error: "SPECTRE_REQUIRED"/, "ack route must name the subscription refusal");
    assert.match(controller, /error: "VERSION_MISMATCH"/, "ack route must refuse a version that is not the published one");
    // Acking requires the publication to exist and equal the claimed version: an ack
    // for a version that cannot be served authorises a download the server never offered.
    assert.match(controller, /publication\.version !== productVersion/, "ack must compare the claim against the publication");
  });

  it("the ack, download and device reports carry per-route rate limits", () => {
    for (const rule of ["GET /api/desktop/download", "POST /api/desktop/installer/ack", "POST /api/desktop/device-state"]) {
      assert.ok(policy.includes(`"${rule}"`), `rate-limit policy is missing ${rule}`);
    }
  });

  it("the schema keeps the acknowledgement and device tables", () => {
    assert.match(schema, /CREATE TABLE IF NOT EXISTS desktop_download_acks/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS desktop_device_state/);
  });

  it("the registry wires in and normalises client-stated facts", () => {
    assert.ok(moduleSource.includes("DesktopInstallerRegistryService"), "registry provider missing from DesktopModule");
    assert.match(registry, /normalizeAckVersion/, "ack version must be normalised before it is stored");
    assert.match(registry, /normalizeOsClaim/, "the stated OS must be normalised before it is stored");
    assert.match(registry, /normalizeDeviceReport/, "device reports must be normalised before they are stored");
    // Stored as a statement, never as a platform fact: the wording must keep "claimed".
    assert.match(registry, /os_claim/, "ack rows must carry the OS claim column");
  });

  it("the installer service fails closed on unknown bytes", () => {
    // A manifest without a sha256, or a file whose bytes disagree, is refused -- the
    // refusal names are the ones the client can display.
    assert.match(installer, /records no sha256; refusing to serve unverified bytes/, "missing sha256 must refuse");
    assert.match(installer, /INSTALLER_INTEGRITY/, "integrity refusal must name the machine-readable error");
    assert.match(installer, /INSTALLER_SIGNATURE/, "signature refusal must name the machine-readable error");
    assert.match(installer, /computeInstallerMac/, "manifest MAC support must be present");
    // Both layouts stay supported: versioned directories first, DESKTOP_INSTALLER_PATH override.
    assert.match(installer, /DESKTOP_INSTALLER_DIR/);
    assert.match(installer, /DESKTOP_INSTALLER_PATH/);
  });
});
