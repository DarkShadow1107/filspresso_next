import { test } from "node:test";
import assert from "node:assert/strict";
import { isVerifiedGithubMerge } from "../scripts/verifySignedHistory.mjs";

test("only the exact GitHub-verified merge identity is accepted", () => {
	const hash = "a".repeat(40);
	const merge = { sha: hash, parents: [{}, {}], commit: { committer: { name: "GitHub", email: "noreply@github.com" }, verification: { verified: true, reason: "valid" } } };
	assert.equal(isVerifiedGithubMerge(merge, hash), true);
	assert.equal(isVerifiedGithubMerge(merge, "b".repeat(40)), false);
	assert.equal(isVerifiedGithubMerge({ ...merge, parents: [{}] }, hash), false);
	assert.equal(isVerifiedGithubMerge({ ...merge, commit: { ...merge.commit, committer: { name: "Alice", email: "alice@example.com" } } }, hash), false);
	assert.equal(isVerifiedGithubMerge({ ...merge, commit: { ...merge.commit, verification: { verified: false, reason: "invalid" } } }, hash), false);
});
