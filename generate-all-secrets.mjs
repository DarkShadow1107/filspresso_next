import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import forge from "node-forge";

const SECRETS_DIR = "secrets";
if (!fs.existsSync(SECRETS_DIR)) {
	fs.mkdirSync(SECRETS_DIR);
}

function generateEd25519KeyPair(name) {
	console.log(`Generating Ed25519 key pair: ${name}...`);
	const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

	const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
	const pubPem = publicKey.export({ type: "spki", format: "pem" });

	fs.writeFileSync(path.join(SECRETS_DIR, `${name}_private_key.pem`), privPem);
	fs.writeFileSync(path.join(SECRETS_DIR, `${name}_public_key.pem`), pubPem);
}

function generateCACertificate() {
	console.log("Generating CA Certificate...");
	const keys = forge.pki.rsa.generateKeyPair(4096);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = "01";
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

	const attrs = [{ name: "commonName", value: "Filspresso-CA" }];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);

	cert.setExtensions([
		{ name: "basicConstraints", cA: true },
		{ name: "keyUsage", keyCertSign: true, digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true },
		{ name: "subjectKeyIdentifier" }
	]);

	cert.sign(keys.privateKey, forge.md.sha256.create());

	const caCertPem = forge.pki.certificateToPem(cert);
	const caKeyPem = forge.pki.privateKeyToPem(keys.privateKey);

	fs.writeFileSync(path.join(SECRETS_DIR, "filspresso_ca_cert.pem"), caCertPem);
	fs.writeFileSync(path.join(SECRETS_DIR, "filspresso_ca_key.pem"), caKeyPem);

	return { cert, privateKey: keys.privateKey };
}

function generateClientCertificate(caCert, caKey, name, commonName, spiffeUri) {
	console.log(`Generating Client Certificate: ${name}...`);
	const keys = forge.pki.rsa.generateKeyPair(4096);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = crypto.randomBytes(16).toString('hex');
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

	cert.setSubject([{ name: "commonName", value: commonName }]);
	cert.setIssuer(caCert.subject.attributes);

	const extensions = [
		{ name: "basicConstraints", cA: false },
		{ name: "keyUsage", digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true },
		{ name: "extKeyUsage", clientAuth: true }
	];

	if (spiffeUri) {
		extensions.push({
			name: "subjectAltName",
			altNames: [{ type: 6, value: spiffeUri }] // type 6 is URI
		});
	}

	cert.setExtensions(extensions);
	cert.sign(caKey, forge.md.sha256.create());

	const certPem = forge.pki.certificateToPem(cert);
	const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

	fs.writeFileSync(path.join(SECRETS_DIR, `${name}_cert.pem`), certPem);
	fs.writeFileSync(path.join(SECRETS_DIR, `${name}_key.pem`), keyPem);
}

function generateServerCertificate(caCert, caKey, name, commonName, dnsNames, ips) {
	console.log(`Generating Server Certificate: ${name}...`);
	const keys = forge.pki.rsa.generateKeyPair(4096);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = crypto.randomBytes(16).toString('hex');
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

	cert.setSubject([{ name: "commonName", value: commonName }]);
	cert.setIssuer(caCert.subject.attributes);

	const altNames = [];
	if (dnsNames) {
		dnsNames.forEach(dns => altNames.push({ type: 2, value: dns })); // type 2 is DNS
	}
	if (ips) {
		ips.forEach(ip => altNames.push({ type: 7, ip: ip })); // type 7 is IP
	}

	cert.setExtensions([
		{ name: "basicConstraints", cA: false },
		{ name: "keyUsage", digitalSignature: true, keyEncipherment: true },
		{ name: "extKeyUsage", serverAuth: true },
		{ name: "subjectAltName", altNames: altNames }
	]);

	cert.sign(caKey, forge.md.sha256.create());

	const certPem = forge.pki.certificateToPem(cert);
	const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

	fs.writeFileSync(path.join(SECRETS_DIR, `${name}_cert.pem`), certPem);
	fs.writeFileSync(path.join(SECRETS_DIR, `${name}_key.pem`), keyPem);
}

async function main() {
	// 1. Ed25519 Keys
	generateEd25519KeyPair("jwt_signing");
	generateEd25519KeyPair("service_assertion");
	generateEd25519KeyPair("ledger_anchor");

	// 2. mTLS Certs
	try {
		console.log("Generating mTLS certificates via node-forge...");
		const { cert: caCert, privateKey: caKey } = generateCACertificate();

		// Go Ops Server
		generateServerCertificate(caCert, caKey, "go_ops_server", "go-ops-server", ["localhost", "go-ops"], ["127.0.0.1"]);
		
		// Go Ops Client
		generateClientCertificate(caCert, caKey, "go_ops_client", "go-ops-client", "spiffe://filspresso/backend");

	} catch (e) {
		console.error("Certificate generation failed:", e);
	}

	// 3. Cleanup .txt files
	console.log("Cleaning up legacy .txt secret files...");
	const files = fs.readdirSync(SECRETS_DIR);
	let deletedCount = 0;
	for (const file of files) {
		if (file.endsWith(".txt") || file.endsWith(".txt.example")) {
			fs.unlinkSync(path.join(SECRETS_DIR, file));
			deletedCount++;
		}
	}
	console.log(`Deleted ${deletedCount} legacy .txt files.`);

	console.log("Done! All keys and certificates generated.");
}

main().catch(console.error);