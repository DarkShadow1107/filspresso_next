import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_MESSAGE_LIMIT, projectAgentMessage } from "../../src/lib/playgroundAgentSources";

test("small attached context is sent exactly and needs no second confirmation", () => {
	const source = { name: "README.md", kind: "github", text: "# Project\nSmall source." };
	const result = projectAgentMessage("Summarize this project.", [source]);
	assert.equal(result.needsConfirmation, false);
	assert.equal(result.message, 'Summarize this project.\n\n<attached-source name="README.md">\n# Project\nSmall source.\n</attached-source>');
	assert.equal(result.compactMessage, result.message);
});

test("large repository context produces a bounded, reviewable overview and prioritized excerpts", () => {
	const source = {
		name: "owner/repository",
		kind: "github",
		sourceUrl: "https://github.com/owner/repository",
		text: [
			"Project file list:\nREADME.md\npackage.json\nsrc/app.ts\nsrc/extra.ts",
			"--- src/extra.ts ---\nextra source ".repeat(3000),
			"--- README.md ---\n# Repository overview\nThis project explains its purpose. ".repeat(300),
			"--- package.json ---\n{\"name\":\"sample\",\"dependencies\":{\"next\":\"16\"}}\n".repeat(120),
			"--- src/app.ts ---\nexport const app = true;\n".repeat(400),
		].join("\n"),
	};
	const result = projectAgentMessage("Identify the project, stack, and likely issues.", [source]);
	assert.equal(result.needsConfirmation, true);
	assert.equal(result.message, result.compactMessage);
	assert.ok(result.projectedCharacters <= AGENT_MESSAGE_LIMIT);
	assert.ok(result.canIncludeSource);
	assert.ok(result.compactMessage.startsWith("Identify the project, stack, and likely issues."));
	assert.match(result.compactMessage, /Selected source context only/);
	assert.match(result.compactMessage, /Repository overview/);
	assert.match(result.compactMessage, /package\.json/);
	assert.match(result.compactMessage, /characters omitted/);
	assert.ok(result.fullCharacters > result.projectedCharacters);
});

test("a full-length prompt does not pretend to include source context", () => {
	const result = projectAgentMessage("p".repeat(AGENT_MESSAGE_LIMIT), [{
		name: "large.txt", kind: "document", text: "source text".repeat(1000),
	}]);
	assert.equal(result.needsConfirmation, true);
	assert.equal(result.canIncludeSource, false);
	assert.ok(result.projectedCharacters <= AGENT_MESSAGE_LIMIT);
});
