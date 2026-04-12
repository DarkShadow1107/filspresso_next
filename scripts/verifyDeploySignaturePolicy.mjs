#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const requiredFiles = ["security/kubernetes/policies/kyverno-verify-image-signatures.yaml"];

const requiredSnippets = [
	"validationFailureAction: Enforce",
	"failurePolicy: Fail",
	"verifyImages:",
	"required: true",
	"type: https://slsa.dev/provenance/v1",
	'issuer: "https://token.actions.githubusercontent.com"',
	'subjectRegExp: "^https://github.com/DarkShadow1107/filspresso_next/.+"',
];

function fail(message, details = []) {
	const output = {
		status: "failed",
		message,
		details,
	};
	console.error(JSON.stringify(output, null, 2));
	process.exit(1);
}

function main() {
	const root = process.cwd();

	const missingFiles = requiredFiles.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)));
	if (missingFiles.length > 0) {
		fail("Required deploy signature policy files are missing", missingFiles);
	}

	const policyPath = path.join(root, requiredFiles[0]);
	const content = fs.readFileSync(policyPath, "utf8");

	const missingSnippets = requiredSnippets.filter((snippet) => !content.includes(snippet));
	if (missingSnippets.length > 0) {
		fail("Deploy signature policy is incomplete", missingSnippets);
	}

	console.log(
		JSON.stringify(
			{
				status: "success",
				policy: requiredFiles[0],
				checks: requiredSnippets.length,
			},
			null,
			2,
		),
	);
}

main();
