#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const dockerfiles = [
	"Dockerfile.ai",
	"Dockerfile.db",
	"Dockerfile.express",
	"go-ops-service/Dockerfile",
	"rust-crypto-service/Dockerfile",
	"java-invoice-service/Dockerfile",
	"kotlin-subscription-service/Dockerfile",
];

function parseFromImages(content) {
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^FROM\s+/i.test(line))
		.map((line) => {
			const withoutFrom = line.replace(/^FROM\s+/i, "").trim();
			const image = withoutFrom.split(/\s+AS\s+/i)[0].trim();
			return image;
		});
}

function analyzeImageReference(image) {
	const hasDigest = image.includes("@sha256:");
	const tagPart = image.includes(":") && !image.includes("@sha256:") ? image.split(":").slice(1).join(":") : "";
	const usesLatest = tagPart === "latest" || (!tagPart && !hasDigest);
	return { image, hasDigest, usesLatest };
}

function main() {
	const enforceDigest = ["1", "true", "yes"].includes(String(process.env.REQUIRE_PINNED_BASE_IMAGES || "true").toLowerCase());
	const report = [];

	for (const relativePath of dockerfiles) {
		const absolutePath = path.join(root, relativePath);
		if (!fs.existsSync(absolutePath)) {
			continue;
		}

		const content = fs.readFileSync(absolutePath, "utf8");
		const entries = parseFromImages(content).map((image) => analyzeImageReference(image));
		report.push({ file: relativePath, entries });
	}

	const findings = [];
	for (const fileReport of report) {
		for (const entry of fileReport.entries) {
			if (entry.usesLatest) {
				findings.push({
					severity: "high",
					file: fileReport.file,
					message: `Base image uses latest/unpinned tag: ${entry.image}`,
				});
			}
			if (!entry.hasDigest) {
				findings.push({
					severity: "medium",
					file: fileReport.file,
					message: `Base image is not digest-pinned: ${entry.image}`,
				});
			}
		}
	}

	const result = {
		enforceDigest,
		dockerfilesChecked: report.length,
		report,
		findings,
	};

	if (findings.length > 0 && enforceDigest) {
		console.error(JSON.stringify({ status: "failed", ...result }, null, 2));
		process.exit(1);
	}

	console.log(JSON.stringify({ status: findings.length ? "warning" : "success", ...result }, null, 2));
}

main();
