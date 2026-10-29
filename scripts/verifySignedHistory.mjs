#!/usr/bin/env node

/**
 * Signed Commit History Policy.
 *
 * Enforcement is a rolling boundary, not a wholesale signature audit:
 *
 *   1. Walk the tested range from newest to oldest.
 *   2. Commits remain trusted until the MOST RECENT unsigned commit; every
 *      commit newer than that boundary must carry a verified signature
 *      (Git `%G?` status G or U).
 *   3. The range must contain at least one signed commit, so an all-unsigned
 *      window can never pass.
 *
 * Legacy unsigned history below the boundary stays accepted — signing became
 * mandatory going forward without a forbidden history rewrite. As new commits
 * land signed, the boundary rolls forward on its own.
 *
 * SSH signatures are verified against scripts/allowed_signers (committed),
 * passed via `git -c`, so the check needs no per-runner configuration. Keep
 * the local commit setup in sync:
 *
 *   git config gpg.format ssh
 *   git config user.signingkey <path-to-filspresso_commit_ed25519.pub>
 *   git config commit.gpgsign true
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowedSigners = path.join(repoRoot, "scripts", "allowed_signers");

/** Git invocation pinned to the repository and to the committed SSH trust file. */
function git(args) {
	return execFileSync("git", ["-C", repoRoot, "-c", "gpg.format=ssh", "-c", `gpg.ssh.allowedSignersFile=${allowedSigners}`, ...args], {
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf8",
	}).toString().trim();
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
			const mergeBase = git(["merge-base", "HEAD", `origin/${baseRef}`]);
			return `${mergeBase}..HEAD`;
		} catch {
			// fall through to last commits window
		}
	}

	const commits = Number.parseInt(args.commits || process.env.SIGNED_HISTORY_COMMITS || "25", 10);
	const maxCommits = Number.isFinite(commits) ? Math.min(Math.max(commits, 1), 500) : 25;
	return `HEAD~${maxCommits}..HEAD`;
}

/**
 * Oldest-to-newest index of the most recent unsigned commit gets rejected newest-first;
 * returns the count of consecutive signed commits from the tip.
 */
function signedTipLength(rows, accepted) {
	let count = 0;
	for (const row of rows) {
		if (!accepted.has(row.status)) break;
		count++;
	}
	return count;
}

function main() {
	const args = parseArgs();
	const range = resolveRange(args);
	const enforce = parseBoolean(args.enforce ?? process.env.SIGNED_HISTORY_ENFORCE, true);
	const accepted = new Set(["G", "U"]);

	const rows = git(["log", "--pretty=format:%H%x09%G?", range])
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

	const signedTip = signedTipLength(rows, accepted);
	const signedTotal = rows.filter((entry) => accepted.has(entry.status)).length;
	const tipHash = rows[0].hash;

	let failure = null;
	if (signedTotal === 0) {
		failure = "no signed commit found in range; the signing policy has no anchor yet";
	} else if (signedTip === 0) {
		failure = `tip commit ${tipHash} is unsigned; every commit newer than the most recent unsigned one must be signed`;
	}

	const report = {
		range,
		checked: rows.length,
		enforce,
		acceptedStatuses: [...accepted],
		signedTip,
		/** The most recent unsigned commit: the boundary below which signing is grandfathered. */
		unsignedBoundary: rows[signedTip]?.hash ?? null,
		signedTotal,
	};

	if (failure) {
		if (!enforce) {
			console.warn(JSON.stringify({ status: "advisory", reason: failure, ...report }, null, 2));
			return;
		}
		console.error(JSON.stringify({ status: "failed", reason: failure, ...report }, null, 2));
		process.exit(1);
	}

	console.log(JSON.stringify({ status: "success", reason: signedTip === rows.length ? "entire range signed" : "tip segment above most recent unsigned commit is signed", ...report }, null, 2));
}

main();
