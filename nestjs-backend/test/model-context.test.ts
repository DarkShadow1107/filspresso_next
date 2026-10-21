import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

const ROOT = path.resolve(__dirname, "..", "..");

const PRESETS = readFileSync(path.join(ROOT, "models", "router-presets.ini"), "utf8");
const FRONTEND = readFileSync(path.join(ROOT, "src", "lib", "modelAccess.ts"), "utf8");

/**
 * The context window each model is served with, read from the router's own preset file.
 *
 * The server allocates the context, so this is not a number the UI gets to choose: a
 * request for more tokens than the window holds is truncated by llama.cpp. The Playground
 * bounds its max-tokens control with the same numbers, so the two have to agree -- a
 * frontend that offers a bigger ceiling than the server can hold looks like a bug to
 * whoever tries it.
 */
function contextSizesFromPresets(): Map<string, number> {
	const sizes = new Map<string, number>();
	let file = "";
	for (const raw of PRESETS.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("[") && line.endsWith("]")) {
			file = "";
			continue;
		}
		const separator = line.indexOf("=");
		if (separator < 0) continue;
		const key = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();
		if (key === "model") {
			// /models/LFM2.5-230M-Q4_K_M.gguf -> LFM2.5-230M-Q4_K_M.gguf
			file = value.split("/").pop() ?? "";
		} else if (key === "ctx-size" && file) {
			sizes.set(file, Number.parseInt(value, 10));
		}
	}
	return sizes;
}

/** The same table, read out of the frontend's TypeScript. */
function contextSizesFromFrontend(): Map<string, number> {
	const constants = new Map(
		[...FRONTEND.matchAll(/export const (\w+) = "(lfm2_5_\w+)"/g)].map((m) => [m[1], m[2]]),
	);
	const start = FRONTEND.indexOf("export const MODEL_CONTEXT_TOKENS");
	assert.notEqual(start, -1, "MODEL_CONTEXT_TOKENS not found in modelAccess.ts");
	const end = FRONTEND.indexOf("\n};", start);
	assert.notEqual(end, -1, "MODEL_CONTEXT_TOKENS literal is not closed");
	const literal = FRONTEND.slice(start, end);

	const sizes = new Map<string, number>();
	for (const match of literal.matchAll(/^\t\[(\w+)\]:\s*(\d+),/gm)) {
		const key = constants.get(match[1]);
		assert.ok(key, `unknown model constant in MODEL_CONTEXT_TOKENS: ${match[1]}`);
		sizes.set(key, Number.parseInt(match[2], 10));
	}
	return sizes;
}

describe("the context windows the Playground offers are the ones the server serves", () => {
	it("reads nine context sizes from the router presets", () => {
		assert.equal(contextSizesFromPresets().size, 9);
	});

	it("the frontend table matches the router presets exactly", () => {
		const fromPresets = contextSizesFromPresets();
		const fromFrontend = contextSizesFromFrontend();

		// The frontend keys the table by model *key* and the file list by GGUF file
		// name, so the comparison is per model: key -> file -> preset size.
		const constants = new Map(
			[...FRONTEND.matchAll(/export const (\w+) = "(lfm2_5_\w+)"/g)].map((m) => [m[1], m[2]]),
		);
		const files = new Map(
			[...FRONTEND.matchAll(/\[(\w+)\]:\s*"(LFM2\.5-[\w.-]+\.gguf)"/g)].map((m) => [m[1], m[2]]),
		);
		assert.equal(files.size, 9, `parsed ${files.size} model file entries`);

		for (const [constant, file] of files) {
			const key = constants.get(constant);
			assert.ok(key, `unknown model constant: ${constant}`);
			const expected = fromPresets.get(file);
			assert.ok(expected, `${file} has no ctx-size in router-presets.ini`);
			assert.equal(
				fromFrontend.get(key),
				expected,
				`${key} claims ${fromFrontend.get(key)} tokens but the server serves ${expected}`,
			);
		}
	});

	it("every model is served with the same window", () => {
		// The LFM 2.5 models are all trained for 128K and all served with it. A
		// model that quietly had a smaller window would be advertised as 128K and
		// then truncate a long conversation, so the sameness is the point.
		const sizes = new Set(contextSizesFromPresets().values());
		assert.equal(sizes.size, 1, `the presets use ${sizes.size} different context sizes`);
		assert.equal([...sizes][0], 131072, "the models are served with 128K");
	});

	it("no model claims a context it cannot have", () => {
		for (const [key, size] of contextSizesFromFrontend()) {
			assert.ok(size >= 1024, `${key} has an implausible context size of ${size}`);
			assert.ok(size % 1024 === 0, `${key} has a context size that is not a whole number of KiB`);
		}
	});
});

describe("the context ladder", () => {
	it("is 16K, 32K, 64K and 128K", () => {
		// The levels the site is sold in, and the stops of the Playground's
		// reply-length control.
		assert.match(FRONTEND, /export const CONTEXT_LEVELS = \[16384, 32768, 65536, 131072\]/);
	});

	it("writes a context size as a level", () => {
		// "128K", not "131,072" and not "128 KB".
		assert.match(FRONTEND, /export function formatContextTokens/);
		assert.match(FRONTEND, /`\$\{tokens \/ 1024\}K`/);
	});
});
