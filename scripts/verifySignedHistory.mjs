#!/usr/bin/env node

import { execSync } from "node:child_process";

function run(command) {
	return execSync(command, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

function parseArgs() {
	const args = Object.fromEntries(
		process.argv.slice(2).map((entry) => {
			const [key, ...rest] = entry.replace(/^--/, "").split("=");
			return [key, rest.join("=") || "true"];
		}),
	);
	return args;
}

function parseBoolean(value, fallback = true) {
	if (value === undefined || value === null || value === "") return fallback;
	const normalized = String(value).trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return fallback;
}

function resolveRange(args) {
	if (args.range) return String(args.range).trim();
	if (process.env.SIGNED_HISTORY_RANGE) return String(process.env.SIGNED_HISTORY_RANGE).trim();

	const baseRef = String(process.env.GITHUB_BASE_REF || "").trim();
	if (baseRef) {
		try {
			const mergeBase = run(`git merge-base HEAD origin/${baseRef}`);
			return `${mergeBase}..HEAD`;
		} catch {
			// fall through to last commits window
		}
	}

	const commits = Number.parseInt(args.commits || process.env.SIGNED_HISTORY_COMMITS || "25", 10);
	const maxCommits = Number.isFinite(commits) ? Math.min(Math.max(commits, 1), 500) : 25;
	return `HEAD~${maxCommits}..HEAD`;
}

function main() {
	const args = parseArgs();
	const range = resolveRange(args);
	const enforce = parseBoolean(args.enforce ?? process.env.SIGNED_HISTORY_ENFORCE, true);
	const output = run(`git log --pretty=format:%H%x09%G? ${range}`);
	const rows = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [hash, status] = line.split("\t");
			return { hash, status: String(status || "N") };
		});

	if (rows.length === 0) {
		console.log(JSON.stringify({ status: "success", range, checked: 0, message: "No commits in range" }, null, 2));
		return;
	}

	const accepted = new Set(["G", "U"]);
	const rejected = rows.filter((entry) => !accepted.has(entry.status));

	const report = {
		range,
		checked: rows.length,
		enforce,
		acceptedStatuses: [...accepted],
		rejectedCount: rejected.length,
		rejected: rejected.slice(0, 20),
	};

	if (rejected.length > 0) {
		if (!enforce) {
			console.warn(JSON.stringify({ status: "advisory", ...report }, null, 2));
			return;
		}
		console.error(JSON.stringify({ status: "failed", ...report }, null, 2));
		process.exit(1);
	}

	console.log(JSON.stringify({ status: "success", ...report }, null, 2));
}

main();
