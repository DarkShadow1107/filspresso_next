import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectArtifact, inertSourcePreview, projectChanges, validateProject } from "../../src/lib/playgroundProject";

test("project bounds reject traversal, aliases, binary, byte overflow and secrets are not executed", () => {
	for (const path of ["../a", "C:/a", "/a", "a//b", "con.txt", "a/b/../c"])
		assert.throws(() => validateProject([{ path, text: "x" }]));
	assert.throws(() => validateProject([{ path: "A.txt", text: "" }, { path: "a.txt", text: "" }]));
	assert.throws(() => validateProject([{ path: "a", text: "" }, { path: "a/b", text: "" }]));
	assert.throws(() => validateProject([{ path: "a.txt", text: "\0" }]));
	assert.throws(() => validateProject([{ path: "a.txt", text: "界".repeat(100_000) }]));
	assert.throws(() => validateProject(Array.from({ length: 257 }, (_, i) => ({ path: `${i}.txt`, text: "" }))));
});

test("artifact manifests preserve exact Unicode/BOM/CRLF bytes with reproducible SHA-256", async () => {
	const input = [{ path: "unicode.txt", text: "\ufeffcafé 界\r\n" }, { path: "empty.txt", text: "" }];
	const a = await createProjectArtifact(input); const b = await createProjectArtifact([...input].reverse());
	assert.deepEqual(a, b); assert.equal(a.files[0].path, "empty.txt");
	assert.equal(a.files[0].sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	assert.equal(a.totalBytes, new TextEncoder().encode(input[0].text).length);
	assert.ok(Object.isFrozen(a.files)); assert.equal(a.files[1].text, input[0].text);
});

test("project observations include added, deleted, empty and command-modified files", () => {
	const changes = projectChanges([{ path: "deleted", text: "old" }, { path: "modified", text: "old" }],
		[{ path: "modified", text: "" }, { path: "command-output.txt", text: "actual guest data" }]);
	assert.deepEqual(changes.map(item => item.kind), ["added", "deleted", "modified"]);
	assert.equal(changes[2].after, "");
});

test("source previews cannot interpret scripts, meta redirects, CSS URLs or closing tags", () => {
	const html = inertSourcePreview('</pre><meta http-equiv="refresh" content="0;url=https://evil.test"><script>fetch("/api/account")</script><img src="https://evil.test">');
	assert.match(html, /default-src &#39;none&#39;|default-src 'none'/);
	assert.doesNotMatch(html, /<script|<img|<meta http-equiv="refresh"/i);
	assert.match(html, /&lt;script&gt;/); assert.match(html, /form-action/);
});
