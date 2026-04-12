#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
	const args = {
		outDir: "secrets",
		force: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--force") {
			args.force = true;
			continue;
		}
		if (token === "--out-dir" && argv[i + 1]) {
			args.outDir = argv[i + 1];
			i += 1;
		}
	}

	return args;
}

function runOpenSSL(args) {
	try {
		execFileSync("openssl", args, { stdio: "pipe" });
	} catch (error) {
		const stderr = String(error?.stderr || "").trim();
		throw new Error(`openssl ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
	}
}

function ensureOpenSSLAvailable() {
	try {
		execFileSync("openssl", ["version"], { stdio: "pipe" });
	} catch {
		throw new Error("OpenSSL executable was not found on PATH. Install OpenSSL and retry.");
	}
}

function ensureDirectory(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function shouldWrite(filePath, force) {
	if (!fs.existsSync(filePath)) return true;
	return force;
}

function writeFile(filePath, content) {
	fs.writeFileSync(filePath, content, { encoding: "utf8" });
}

function generateCA(paths, force) {
	if (!shouldWrite(paths.caKey, force) && !shouldWrite(paths.caCert, force)) {
		return "kept";
	}

	runOpenSSL(["genrsa", "-out", paths.caKey, "4096"]);
	runOpenSSL([
		"req",
		"-x509",
		"-new",
		"-nodes",
		"-key",
		paths.caKey,
		"-sha256",
		"-days",
		"3650",
		"-out",
		paths.caCert,
		"-subj",
		"/CN=Filspresso Local CA",
	]);
	return "written";
}

function generateLeafCertificate(options) {
	const { cn, spiffeUri, dnsNames, eku, keyPath, csrPath, certPath, extPath, caCert, caKey, force } = options;

	if (!shouldWrite(keyPath, force) && !shouldWrite(certPath, force)) {
		return "kept";
	}

	runOpenSSL(["genrsa", "-out", keyPath, "2048"]);
	runOpenSSL(["req", "-new", "-key", keyPath, "-out", csrPath, "-subj", `/CN=${cn}`]);

	const sanEntries = [...dnsNames.map((name) => `DNS:${name}`), `URI:${spiffeUri}`];
	writeFile(
		extPath,
		[
			"basicConstraints=CA:FALSE",
			"keyUsage=digitalSignature,keyEncipherment",
			`extendedKeyUsage=${eku}`,
			`subjectAltName=${sanEntries.join(",")}`,
		].join("\n"),
	);

	runOpenSSL([
		"x509",
		"-req",
		"-in",
		csrPath,
		"-CA",
		caCert,
		"-CAkey",
		caKey,
		"-CAcreateserial",
		"-out",
		certPath,
		"-days",
		"825",
		"-sha256",
		"-extfile",
		extPath,
	]);

	fs.rmSync(csrPath, { force: true });
	fs.rmSync(extPath, { force: true });
	return "written";
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const outDir = path.resolve(process.cwd(), args.outDir);
	ensureOpenSSLAvailable();
	ensureDirectory(outDir);

	const paths = {
		caKey: path.join(outDir, "filspresso_ca_key.pem"),
		caCert: path.join(outDir, "filspresso_ca_cert.pem"),
		serverKey: path.join(outDir, "go_ops_server_key.pem"),
		serverCert: path.join(outDir, "go_ops_server_cert.pem"),
		clientKey: path.join(outDir, "go_ops_client_key.pem"),
		clientCert: path.join(outDir, "go_ops_client_cert.pem"),
	};

	const tempPaths = {
		serverCsr: path.join(outDir, "go_ops_server.csr"),
		serverExt: path.join(outDir, "go_ops_server.ext"),
		clientCsr: path.join(outDir, "go_ops_client.csr"),
		clientExt: path.join(outDir, "go_ops_client.ext"),
	};

	console.log(`Generating mTLS material in ${outDir}`);

	const caState = generateCA(paths, args.force);
	console.log(`CA certificate: ${caState}`);

	const serverState = generateLeafCertificate({
		cn: "go-ops",
		spiffeUri: "spiffe://filspresso/internal/go-ops",
		dnsNames: ["go-ops", "localhost"],
		eku: "serverAuth",
		keyPath: paths.serverKey,
		csrPath: tempPaths.serverCsr,
		certPath: paths.serverCert,
		extPath: tempPaths.serverExt,
		caCert: paths.caCert,
		caKey: paths.caKey,
		force: args.force,
	});
	console.log(`go_ops server certificate: ${serverState}`);

	const clientState = generateLeafCertificate({
		cn: "backend",
		spiffeUri: "spiffe://filspresso/internal/backend",
		dnsNames: ["backend", "localhost"],
		eku: "clientAuth",
		keyPath: paths.clientKey,
		csrPath: tempPaths.clientCsr,
		certPath: paths.clientCert,
		extPath: tempPaths.clientExt,
		caCert: paths.caCert,
		caKey: paths.caKey,
		force: args.force,
	});
	console.log(`backend client certificate: ${clientState}`);

	console.log("mTLS generation complete.");
	console.log("Recommended next steps:");
	console.log("1) Set security.env.example paths for GO_OPS_* and FILSPRESSO_CA_CERT_FILE_PATH");
	console.log("2) Start hardened compose profile with docker-compose.security.yml");
}

try {
	main();
} catch (error) {
	console.error("mTLS certificate generation failed:", error.message || String(error));
	process.exit(1);
}
